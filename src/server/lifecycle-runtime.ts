import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { AppConfig } from "./config.js";
import { migrate, openDatabase, resolveDbPath } from "./db.js";
import { DisplayStore } from "./display.js";
import {
  createCatalogBackup,
  deleteCatalogBackup,
  stageRestoreCandidate,
  toPublicMeta,
  verifyCatalogBackupFile,
  type BackupPublicMeta,
} from "./backup-catalog.js";
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
  beforeBackup?: () => void | Promise<void>;
  afterBackup?: () => void | Promise<void>;
  beforeScrub?: () => void | Promise<void>;
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
  /** Backup id pinned by an in-flight restore (blocks delete). */
  pinnedRestoreBackupId: string | null;
  /** Wait while an exclusive replacement holds the barrier. */
  acquireShared(): Promise<void>;
  releaseShared(): void;
  withExclusive<T>(fn: () => Promise<T>): Promise<T>;
  createBackup(input: {
    label?: string | null;
  }): Promise<BackupPublicMeta>;
  registerLegacyBackup(input: {
    legacySourceAbs: string;
    label?: string | null;
  }): Promise<BackupPublicMeta>;
  deleteBackup(backupId: string): Promise<void>;
  replaceWithEmptyDatabase(input: {
    operationId: string;
    sourceEpoch: number;
    saveBackupBefore?: boolean;
    backupLabel?: string | null;
  }): Promise<{
    resultEpoch: number;
    cleanupFailures: string[];
    preOperationBackup: BackupPublicMeta | null;
  }>;
  replaceWithRestoredDatabase(input: {
    operationId: string;
    sourceEpoch: number;
    backupId: string;
    expectedDigest: string;
    saveBackupBefore?: boolean;
    backupLabel?: string | null;
  }): Promise<{
    resultEpoch: number;
    cleanupFailures: string[];
    preOperationBackup: BackupPublicMeta | null;
    restoredBackup: BackupPublicMeta;
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
  if (process.env.LIFECYCLE_FAULT_BEFORE_BACKUP === "1") {
    hooks.beforeBackup = () => {
      throw new Error("fault:beforeBackup");
    };
  }
  if (process.env.LIFECYCLE_FAULT_BEFORE_SCRUB === "1") {
    hooks.beforeScrub = () => {
      throw new Error("fault:beforeScrub");
    };
  }
  return hooks;
}

function recoveredResetResponse(op: LifecycleOperationRow, resultEpoch: number) {
  return {
    operationId: op.id,
    kind: "household_reset",
    sourceEpoch: op.sourceEpoch,
    resultEpoch,
    installationEpoch: resultEpoch,
    cleanupFailures: [] as string[],
    setupRequired: true,
    preOperationBackup: null,
    recovered: true,
  };
}

function recoveredRestoreResponse(op: LifecycleOperationRow, resultEpoch: number) {
  let restoredBackup: unknown = null;
  let preOperationBackup: unknown = null;
  try {
    const partial = op.responseJson ? (JSON.parse(op.responseJson) as Record<string, unknown>) : {};
    restoredBackup = partial.restoredBackup ?? null;
    preOperationBackup = partial.preOperationBackup ?? null;
  } catch {
    /* ignore */
  }
  return {
    operationId: op.id,
    kind: "household_restore",
    sourceEpoch: op.sourceEpoch,
    resultEpoch,
    installationEpoch: resultEpoch,
    cleanupFailures: [] as string[],
    setupRequired: false,
    signInRequired: true,
    restoredBackup,
    preOperationBackup,
    recovered: true,
  };
}

function recoveredBackupResponse(op: LifecycleOperationRow) {
  let backup: unknown = null;
  try {
    const partial = op.responseJson ? (JSON.parse(op.responseJson) as Record<string, unknown>) : {};
    backup = partial.backup ?? null;
  } catch {
    /* ignore */
  }
  return {
    operationId: op.id,
    kind: "household_backup",
    sourceEpoch: op.sourceEpoch,
    resultEpoch: op.sourceEpoch,
    backup,
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
  /** Serializes catalog create/delete with reset/restore without quiescing ordinary reads. */
  let catalogHeld = false;
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

  async function withCatalogLock<T>(fn: () => Promise<T>): Promise<T> {
    await waitUntil(() => !exclusiveHeld && !catalogHeld);
    catalogHeld = true;
    try {
      return await fn();
    } finally {
      catalogHeld = false;
      notifyWaiters();
    }
  }

  async function optionalPreBackup(input: {
    saveBackupBefore?: boolean;
    backupLabel?: string | null;
  }): Promise<BackupPublicMeta | null> {
    if (!input.saveBackupBefore) return null;
    await faultHooks.beforeBackup?.();
    const meta = await createCatalogBackup({
      control,
      backupDir: config.backupDir,
      activeDbPath: runtime.activeDbPath,
      liveDb: runtime.db,
      label: input.backupLabel ?? null,
      source: "app",
    });
    await faultHooks.afterBackup?.();
    return meta;
  }

  function candidatePaths(nextEpoch: number): { relative: string; abs: string } {
    const dir = path.posix.dirname(runtime.activeDbRelativePath);
    const base = path.basename(
      runtime.activeDbRelativePath,
      path.extname(runtime.activeDbRelativePath),
    );
    const relative = `${dir}/${base}.epoch-${nextEpoch}.sqlite`;
    return { relative, abs: resolveActiveDbAbsolutePath(relative) };
  }

  async function activateAndCleanup(input: {
    nextEpoch: number;
    candidateRelative: string;
    oldDbPath: string;
  }): Promise<{ resultEpoch: number; cleanupFailures: string[] }> {
    await faultHooks.beforeActivate?.();
    control.activateCandidate(input.nextEpoch, input.candidateRelative);

    // Durable activation committed: swap runtime handles before any later fault
    // so the process never serves stale store/db against the new control pointer.
    runtime.reopenFromControlState();
    await faultHooks.afterActivate?.();
    await faultHooks.afterReopen?.();

    const cleanupFailures: string[] = [];
    await faultHooks.beforeCleanup?.();
    for (const target of [
      input.oldDbPath,
      `${input.oldDbPath}-wal`,
      `${input.oldDbPath}-shm`,
    ]) {
      try {
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
      } catch (err) {
        cleanupFailures.push(
          `${target}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { resultEpoch: input.nextEpoch, cleanupFailures };
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
    pinnedRestoreBackupId: null,
    async acquireShared(): Promise<void> {
      await waitUntil(() => !exclusiveHeld);
      sharedHolders += 1;
    },
    releaseShared(): void {
      sharedHolders = Math.max(0, sharedHolders - 1);
      notifyWaiters();
    },
    async withExclusive<T>(fn: () => Promise<T>): Promise<T> {
      await waitUntil(() => !exclusiveHeld && !catalogHeld && sharedHolders === 0);
      exclusiveHeld = true;
      try {
        // Drain any shared holders that slipped in before the flag flipped.
        await waitUntil(() => sharedHolders === 0 && !catalogHeld);
        return await fn();
      } finally {
        exclusiveHeld = false;
        notifyWaiters();
      }
    },
    async createBackup(input) {
      return withCatalogLock(async () => {
        await faultHooks.beforeBackup?.();
        const meta = await createCatalogBackup({
          control,
          backupDir: config.backupDir,
          activeDbPath: runtime.activeDbPath,
          liveDb: runtime.db,
          label: input.label ?? null,
          source: "app",
        });
        await faultHooks.afterBackup?.();
        return meta;
      });
    },
    async registerLegacyBackup(input) {
      return withCatalogLock(async () => {
        await faultHooks.beforeBackup?.();
        const meta = await createCatalogBackup({
          control,
          backupDir: config.backupDir,
          activeDbPath: runtime.activeDbPath,
          liveDb: runtime.db,
          label: input.label ?? null,
          source: "legacy_register",
          legacySourceAbs: input.legacySourceAbs,
        });
        await faultHooks.afterBackup?.();
        return meta;
      });
    },
    async deleteBackup(backupId) {
      return withCatalogLock(async () => {
        deleteCatalogBackup({
          control,
          backupDir: config.backupDir,
          backupId,
          pinnedBackupId: runtime.pinnedRestoreBackupId,
        });
      });
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
          let response: Record<string, unknown>;
          if (op.kind === "household_restore") {
            response = recoveredRestoreResponse(op, current.datasetEpoch);
          } else if (op.kind === "household_backup") {
            // Backup alone does not advance epoch; if epoch moved, it was superseded.
            control.failLifecycleOperation(
              op.id,
              JSON.stringify({
                code: "FAILED",
                message: "Backup interrupted by a later household replacement",
              }),
            );
            resolved.push(control.getLifecycleOperation(op.id)!);
            continue;
          } else {
            response = recoveredResetResponse(op, current.datasetEpoch);
          }
          control.completeLifecycleOperation(
            op.id,
            current.datasetEpoch,
            JSON.stringify(response),
          );
          resolved.push(control.getLifecycleOperation(op.id)!);
        } else if (op.sourceEpoch === current.datasetEpoch) {
          if (op.kind === "household_backup" && op.responseJson) {
            // Backup may have written a partial success marker before crash.
            try {
              const partial = JSON.parse(op.responseJson) as { backup?: BackupPublicMeta };
              if (partial.backup?.id && control.getBackup(partial.backup.id)) {
                control.completeLifecycleOperation(
                  op.id,
                  current.datasetEpoch,
                  JSON.stringify(recoveredBackupResponse(op)),
                );
                resolved.push(control.getLifecycleOperation(op.id)!);
                continue;
              }
            } catch {
              /* fall through to fail */
            }
          }
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
      runtime.pinnedRestoreBackupId = null;
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

        const preOperationBackup = await optionalPreBackup({
          saveBackupBefore: input.saveBackupBefore,
          backupLabel: input.backupLabel,
        });

        const oldDbPath = runtime.activeDbPath;
        const nextEpoch = current.datasetEpoch + 1;
        const candidate = candidatePaths(nextEpoch);

        await faultHooks.beforePrepare?.();
        fs.mkdirSync(path.dirname(candidate.abs), { recursive: true });
        if (fs.existsSync(candidate.abs)) {
          fs.rmSync(candidate.abs, { force: true });
          fs.rmSync(`${candidate.abs}-wal`, { force: true });
          fs.rmSync(`${candidate.abs}-shm`, { force: true });
        }
        const prepared = openDatabase(candidate.abs);
        migrate(prepared);
        prepared.close();

        const activated = await activateAndCleanup({
          nextEpoch,
          candidateRelative: candidate.relative,
          oldDbPath,
        });
        return { ...activated, preOperationBackup };
      });
    },
    async replaceWithRestoredDatabase(input) {
      return runtime.withExclusive(async () => {
        const current = control.getState();
        if (current.datasetEpoch !== input.sourceEpoch) {
          throw Object.assign(new Error("Installation epoch conflict"), {
            code: "CONFLICT",
          });
        }
        if (runtime.store.countHouseholds() > 1) {
          throw Object.assign(
            new Error("Multiple households are not supported for lifecycle restore"),
            { code: "CONFLICT" },
          );
        }

        const row = control.getBackup(input.backupId);
        if (!row) {
          throw Object.assign(new Error("Backup not found"), { code: "NOT_FOUND" });
        }
        if (row.contentDigest !== input.expectedDigest) {
          throw Object.assign(new Error("Backup digest mismatch"), { code: "CONFLICT" });
        }
        const verified = verifyCatalogBackupFile(config.backupDir, row);
        if ("error" in verified) {
          throw Object.assign(new Error(verified.error.message), {
            code: verified.error.code,
          });
        }
        const restoredBackup = toPublicMeta(row);
        runtime.pinnedRestoreBackupId = row.id;

        try {
          const preOperationBackup = await optionalPreBackup({
            saveBackupBefore: input.saveBackupBefore,
            backupLabel: input.backupLabel,
          });

          const oldDbPath = runtime.activeDbPath;
          const nextEpoch = current.datasetEpoch + 1;
          const candidate = candidatePaths(nextEpoch);

          await faultHooks.beforePrepare?.();
          await stageRestoreCandidate({
            sourceAbs: verified.absPath,
            candidateAbs: candidate.abs,
          });
          await faultHooks.beforeScrub?.();
          // Scrub already applied inside stageRestoreCandidate; revoke control setup tickets.
          control.revokeSetupAuthorityForRestore();

          const activated = await activateAndCleanup({
            nextEpoch,
            candidateRelative: candidate.relative,
            oldDbPath,
          });
          return { ...activated, preOperationBackup, restoredBackup };
        } finally {
          runtime.pinnedRestoreBackupId = null;
        }
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
