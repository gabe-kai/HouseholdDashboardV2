import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { AppConfig } from "./config.js";
import { migrate, openDatabase, resolveDbPath } from "./db.js";
import { DisplayStore } from "./display.js";
import {
  InstallationControl,
  relativeDbPathFromConfig,
  resolveActiveDbAbsolutePath,
  resolveInstallationControlPath,
  type LifecycleOperationRow,
} from "./installation-control.js";
import { AppStore } from "./store.js";

export type LifecycleFaultHooks = {
  beforePrepare?: () => void | Promise<void>;
  beforeActivate?: () => void | Promise<void>;
  afterActivate?: () => void | Promise<void>;
  beforeCleanup?: () => void | Promise<void>;
  /** After durable activation + reopen/ref swap, before cleanup/response. */
  afterReopen?: () => void | Promise<void>;
};

export type LifecycleRuntime = {
  config: AppConfig;
  control: InstallationControl;
  db: Database.Database;
  store: AppStore;
  displayStore: DisplayStore;
  epoch: number;
  activeDbPath: string;
  activeDbRelativePath: string;
  installationId: string;
  faultHooks: LifecycleFaultHooks;
  /** Wait while an exclusive replacement holds the barrier. */
  acquireShared(): Promise<void>;
  releaseShared(): void;
  withExclusive<T>(fn: () => Promise<T>): Promise<T>;
  replaceWithEmptyDatabase(input: {
    operationId: string;
    sourceEpoch: number;
  }): Promise<{
    resultEpoch: number;
    cleanupFailures: string[];
  }>;
  reopenFromControlState(): void;
  /** Complete/fail interrupted ops and finish deferred cleanup after restart. */
  reconcilePendingOperations(): LifecycleOperationRow[];
};

function envFaultHooks(): LifecycleFaultHooks {
  const hooks: LifecycleFaultHooks = {};
  if (process.env.LIFECYCLE_FAULT_BEFORE_PREPARE === "1") {
    hooks.beforePrepare = () => {
      throw new Error("fault:beforePrepare");
    };
  }
  if (process.env.LIFECYCLE_FAULT_BEFORE_ACTIVATE === "1") {
    hooks.beforeActivate = () => {
      throw new Error("fault:beforeActivate");
    };
  }
  if (process.env.LIFECYCLE_FAULT_AFTER_ACTIVATE === "1") {
    hooks.afterActivate = () => {
      throw new Error("fault:afterActivate");
    };
  }
  if (process.env.LIFECYCLE_FAULT_AFTER_REOPEN === "1") {
    hooks.afterReopen = () => {
      throw new Error("fault:afterReopen");
    };
  }
  if (process.env.LIFECYCLE_FAULT_BEFORE_CLEANUP === "1") {
    hooks.beforeCleanup = () => {
      throw new Error("fault:beforeCleanup");
    };
  }
  return hooks;
}

function recoveredResetResponse(op: LifecycleOperationRow, resultEpoch: number) {
  return {
    operationId: op.id,
    sourceEpoch: op.sourceEpoch,
    resultEpoch,
    installationEpoch: resultEpoch,
    cleanupFailures: [] as string[],
    setupRequired: true,
    recovered: true,
  };
}

export function createLifecycleRuntime(
  config: AppConfig,
  options?: {
    faultHooks?: LifecycleFaultHooks;
    /** Called synchronously after reopen while exclusive barrier is held. */
    onRuntimeSwapped?: () => void;
  },
): LifecycleRuntime {
  const controlPath = resolveInstallationControlPath(config.installationControlPath);
  const control = InstallationControl.open(controlPath);
  const configuredRelative = relativeDbPathFromConfig(config.dbPath);
  const state = control.ensureAdopt(configuredRelative);
  const activeDbRelativePath = state.activeDbRelativePath;
  const activeDbPath = resolveActiveDbAbsolutePath(activeDbRelativePath);

  const db = openDatabase(activeDbPath);
  migrate(db);
  const store = new AppStore(db);
  const displayStore = new DisplayStore(db, store);

  let sharedHolders = 0;
  let exclusiveHeld = false;
  const waiters: Array<() => void> = [];
  const faultHooks = { ...envFaultHooks(), ...options?.faultHooks };
  const onRuntimeSwapped = options?.onRuntimeSwapped;

  function notifyWaiters(): void {
    const pending = waiters.splice(0);
    for (const wake of pending) wake();
  }

  function waitUntil(predicate: () => boolean): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve) => {
      const tryWake = () => {
        if (predicate()) resolve();
        else waiters.push(tryWake);
      };
      waiters.push(tryWake);
    });
  }

  const runtime: LifecycleRuntime = {
    config,
    control,
    db,
    store,
    displayStore,
    epoch: state.datasetEpoch,
    activeDbPath,
    activeDbRelativePath,
    installationId: state.installationId,
    faultHooks,
    async acquireShared(): Promise<void> {
      await waitUntil(() => !exclusiveHeld);
      sharedHolders += 1;
    },
    releaseShared(): void {
      sharedHolders = Math.max(0, sharedHolders - 1);
      notifyWaiters();
    },
    async withExclusive<T>(fn: () => Promise<T>): Promise<T> {
      await waitUntil(() => !exclusiveHeld && sharedHolders === 0);
      exclusiveHeld = true;
      try {
        // Drain any shared holders that slipped in before the flag flipped.
        await waitUntil(() => sharedHolders === 0);
        return await fn();
      } finally {
        exclusiveHeld = false;
        notifyWaiters();
      }
    },
    reopenFromControlState(): void {
      const next = control.getState();
      const previous = runtime.db;
      runtime.activeDbRelativePath = next.activeDbRelativePath;
      runtime.activeDbPath = resolveActiveDbAbsolutePath(next.activeDbRelativePath);
      runtime.epoch = next.datasetEpoch;
      runtime.db = openDatabase(runtime.activeDbPath);
      migrate(runtime.db);
      runtime.store = new AppStore(runtime.db);
      runtime.displayStore = new DisplayStore(runtime.db, runtime.store);
      onRuntimeSwapped?.();
      try {
        previous.close();
      } catch {
        /* previous handle may already be closed */
      }
    },
    reconcilePendingOperations(): LifecycleOperationRow[] {
      const current = control.getState();
      const resolved: LifecycleOperationRow[] = [];
      for (const op of control.listPendingOperations()) {
        if (op.sourceEpoch < current.datasetEpoch) {
          const response = recoveredResetResponse(op, current.datasetEpoch);
          control.completeLifecycleOperation(
            op.id,
            current.datasetEpoch,
            JSON.stringify(response),
          );
          resolved.push(control.getLifecycleOperation(op.id)!);
        } else if (op.sourceEpoch === current.datasetEpoch) {
          control.failLifecycleOperation(
            op.id,
            JSON.stringify({
              code: "FAILED",
              message: "Lifecycle operation interrupted before activation",
            }),
          );
          resolved.push(control.getLifecycleOperation(op.id)!);
        }
      }
      cleanupOrphanEpochFiles(runtime.activeDbRelativePath, runtime.activeDbPath);
      return resolved;
    },
    async replaceWithEmptyDatabase(input) {
      return runtime.withExclusive(async () => {
        const current = control.getState();
        if (current.datasetEpoch !== input.sourceEpoch) {
          throw Object.assign(new Error("Installation epoch conflict"), {
            code: "CONFLICT",
          });
        }
        if (runtime.store.countHouseholds() > 1) {
          throw Object.assign(
            new Error("Multiple households are not supported for lifecycle reset"),
            { code: "CONFLICT" },
          );
        }

        const oldDbPath = runtime.activeDbPath;
        const nextEpoch = current.datasetEpoch + 1;
        const dir = path.posix.dirname(runtime.activeDbRelativePath);
        const base = path.basename(
          runtime.activeDbRelativePath,
          path.extname(runtime.activeDbRelativePath),
        );
        const candidateRelative = `${dir}/${base}.epoch-${nextEpoch}.sqlite`;
        const candidateAbs = resolveActiveDbAbsolutePath(candidateRelative);

        await runtime.faultHooks.beforePrepare?.();
        fs.mkdirSync(path.dirname(candidateAbs), { recursive: true });
        if (fs.existsSync(candidateAbs)) {
          fs.rmSync(candidateAbs, { force: true });
          fs.rmSync(`${candidateAbs}-wal`, { force: true });
          fs.rmSync(`${candidateAbs}-shm`, { force: true });
        }
        const prepared = openDatabase(candidateAbs);
        migrate(prepared);
        prepared.close();

        await runtime.faultHooks.beforeActivate?.();
        control.activateCandidate(nextEpoch, candidateRelative);

        // Durable activation committed: swap runtime handles before any later fault
        // so the process never serves stale store/db against the new control pointer.
        runtime.reopenFromControlState();
        await runtime.faultHooks.afterActivate?.();
        await runtime.faultHooks.afterReopen?.();

        const cleanupFailures: string[] = [];
        await runtime.faultHooks.beforeCleanup?.();
        for (const target of [oldDbPath, `${oldDbPath}-wal`, `${oldDbPath}-shm`]) {
          try {
            if (fs.existsSync(target)) fs.rmSync(target, { force: true });
          } catch (err) {
            cleanupFailures.push(
              `${target}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        return { resultEpoch: nextEpoch, cleanupFailures };
      });
    },
  };

  runtime.reconcilePendingOperations();
  return runtime;
}

function cleanupOrphanEpochFiles(activeRelative: string, activeAbs: string): void {
  const dir = path.dirname(activeAbs);
  if (!fs.existsSync(dir)) return;
  const stem = path.basename(activeRelative).replace(/\.epoch-\d+\.sqlite$/i, "");
  const baseStem = stem.replace(/\.sqlite$/i, "");
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.startsWith(`${baseStem}.epoch-`) || !entry.endsWith(".sqlite")) continue;
    const abs = path.join(dir, entry);
    if (path.resolve(abs) === path.resolve(activeAbs)) continue;
    for (const target of [abs, `${abs}-wal`, `${abs}-shm`]) {
      try {
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

/** Resolve active household DB for operator scripts when control store exists. */
export function resolveActiveHouseholdDbPath(config: AppConfig): string {
  const controlPath = resolveInstallationControlPath(config.installationControlPath);
  if (!fs.existsSync(controlPath)) {
    return resolveDbPath(config.dbPath);
  }
  const control = InstallationControl.open(controlPath);
  try {
    const state = control.getState();
    return resolveActiveDbAbsolutePath(state.activeDbRelativePath);
  } finally {
    control.close();
  }
}
