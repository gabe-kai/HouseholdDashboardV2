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
} from "./installation-control.js";
import { AppStore } from "./store.js";

export type LifecycleFaultHooks = {
  beforePrepare?: () => void | Promise<void>;
  beforeActivate?: () => void | Promise<void>;
  afterActivate?: () => void | Promise<void>;
  beforeCleanup?: () => void | Promise<void>;
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
  withMutex<T>(fn: () => Promise<T>): Promise<T>;
  replaceWithEmptyDatabase(input: {
    operationId: string;
    sourceEpoch: number;
  }): Promise<{
    resultEpoch: number;
    cleanupFailures: string[];
  }>;
  reopenFromControlState(): void;
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
  if (process.env.LIFECYCLE_FAULT_BEFORE_CLEANUP === "1") {
    hooks.beforeCleanup = () => {
      throw new Error("fault:beforeCleanup");
    };
  }
  return hooks;
}

export function createLifecycleRuntime(
  config: AppConfig,
  options?: { faultHooks?: LifecycleFaultHooks },
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

  let mutex: Promise<void> = Promise.resolve();
  const faultHooks = { ...envFaultHooks(), ...options?.faultHooks };

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
    withMutex<T>(fn: () => Promise<T>): Promise<T> {
      const run = mutex.then(fn, fn);
      mutex = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    reopenFromControlState(): void {
      const next = control.getState();
      runtime.db.close();
      runtime.activeDbRelativePath = next.activeDbRelativePath;
      runtime.activeDbPath = resolveActiveDbAbsolutePath(next.activeDbRelativePath);
      runtime.epoch = next.datasetEpoch;
      runtime.db = openDatabase(runtime.activeDbPath);
      migrate(runtime.db);
      runtime.store = new AppStore(runtime.db);
      runtime.displayStore = new DisplayStore(runtime.db, runtime.store);
    },
    async replaceWithEmptyDatabase(input) {
      return runtime.withMutex(async () => {
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
        const base = path.basename(runtime.activeDbRelativePath, path.extname(runtime.activeDbRelativePath));
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

        await runtime.faultHooks.afterActivate?.();
        runtime.reopenFromControlState();

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

  return runtime;
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
