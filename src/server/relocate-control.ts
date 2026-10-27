import fs from "node:fs";
import path from "node:path";
import DatabaseConstructor from "better-sqlite3";
import { resolveConfiguredPath } from "./config.js";
import {
  failClosedInstallation,
  inspectInstallationControl,
  resolveActiveDbAbsolutePath,
  resolveInstallationControlPath,
} from "./installation-control.js";

export type RelocateControlInput = {
  sourcePath: string;
  destPath: string;
  backupDir?: string;
};

export type RelocateControlResult = {
  sourcePath: string;
  destPath: string;
  installationId: string;
  datasetEpoch: number;
  activeDatabasePath: string;
};

function sqliteArtifacts(filePath: string): string[] {
  return [filePath, `${filePath}-wal`, `${filePath}-shm`];
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function catalogFingerprint(controlPath: string): string[] {
  const db = new DatabaseConstructor(controlPath, { readonly: true, fileMustExist: true });
  try {
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'household_backups'`)
      .get() as { name: string } | undefined;
    if (!table) return [];
    return (
      db
        .prepare(
          `SELECT id FROM household_backups WHERE deleted_at IS NULL ORDER BY id`,
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
  } finally {
    db.close();
  }
}

function integrityOk(controlPath: string): boolean {
  const db = new DatabaseConstructor(controlPath, { readonly: true, fileMustExist: true });
  try {
    return db.pragma("quick_check", { simple: true }) === "ok";
  } finally {
    db.close();
  }
}

export async function relocateInstallationControl(
  input: RelocateControlInput,
): Promise<RelocateControlResult> {
  const sourcePath = resolveInstallationControlPath(input.sourcePath);
  const destPath = resolveInstallationControlPath(input.destPath);
  if (path.resolve(sourcePath) === path.resolve(destPath)) {
    throw failClosedInstallation("Control relocation source and destination must differ.");
  }
  if (!fileExists(sourcePath)) {
    throw failClosedInstallation(`Control relocation source is missing at ${sourcePath}.`);
  }
  for (const artifact of sqliteArtifacts(destPath)) {
    if (fileExists(artifact)) {
      throw failClosedInstallation(
        `Control relocation destination already exists at ${artifact}.`,
      );
    }
  }

  const inspection = inspectInstallationControl(sourcePath);
  if (inspection.status !== "valid") {
    throw failClosedInstallation(
      `Control relocation source is ${inspection.status === "missing" ? "missing" : `invalid (${inspection.reason})`}.`,
    );
  }

  const activeDatabasePath = resolveActiveDbAbsolutePath(inspection.state.activeDbRelativePath);
  if (!fileExists(activeDatabasePath)) {
    throw failClosedInstallation(
      `Control relocation aborted because the referenced active database is missing at ${activeDatabasePath}.`,
    );
  }
  if (input.backupDir) {
    const backupRoot = resolveConfiguredPath(input.backupDir);
    const relative = path.relative(backupRoot, activeDatabasePath);
    const insideBackup =
      relative === "" ||
      (!path.isAbsolute(relative) &&
        !relative.startsWith(`..${path.sep}`) &&
        relative !== "..");
    if (insideBackup) {
      throw failClosedInstallation(
        "Control relocation refuses to treat a household backup image as the live database.",
      );
    }
  }

  const sourceStat = fs.statSync(sourcePath);
  const destTmp = `${destPath}.relocate-tmp`;
  for (const leftover of sqliteArtifacts(destTmp)) {
    fs.rmSync(leftover, { force: true });
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const source = new DatabaseConstructor(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destTmp);
  } finally {
    source.close();
  }

  try {
    if (!integrityOk(destTmp)) {
      throw failClosedInstallation("Copied control store failed SQLite integrity check.");
    }
    const copied = inspectInstallationControl(destTmp);
    if (copied.status !== "valid") {
      throw failClosedInstallation(
        `Copied control store is invalid (${copied.status === "invalid" ? copied.reason : "missing"}).`,
      );
    }
    if (
      copied.state.installationId !== inspection.state.installationId ||
      copied.state.datasetEpoch !== inspection.state.datasetEpoch ||
      copied.state.activeDbRelativePath !== inspection.state.activeDbRelativePath
    ) {
      throw failClosedInstallation("Copied control store does not match the source installation identity.");
    }
    const sourceCatalog = catalogFingerprint(sourcePath).join(",");
    const destCatalog = catalogFingerprint(destTmp).join(",");
    if (sourceCatalog !== destCatalog) {
      throw failClosedInstallation("Copied control store catalog does not match the source catalog.");
    }
    if (!fileExists(activeDatabasePath)) {
      throw failClosedInstallation(
        `Control relocation aborted because the referenced active database disappeared at ${activeDatabasePath}.`,
      );
    }
    fs.renameSync(destTmp, destPath);
  } catch (err) {
    for (const leftover of sqliteArtifacts(destTmp)) {
      fs.rmSync(leftover, { force: true });
    }
    for (const artifact of sqliteArtifacts(destPath)) {
      if (path.resolve(artifact) === path.resolve(sourcePath)) continue;
      fs.rmSync(artifact, { force: true });
    }
    throw err;
  }

  const sourceAfter = fs.statSync(sourcePath);
  if (sourceAfter.size !== sourceStat.size) {
    throw failClosedInstallation("Control relocation changed the source control store; aborting.");
  }

  return {
    sourcePath,
    destPath,
    installationId: inspection.state.installationId,
    datasetEpoch: inspection.state.datasetEpoch,
    activeDatabasePath,
  };
}
