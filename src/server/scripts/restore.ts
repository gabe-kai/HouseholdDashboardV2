import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadConfig } from "../config.js";
import { resolveDbPath } from "../db.js";

const backupArgument = process.argv[2];
if (!backupArgument) {
  throw new Error("Usage: npm run db:restore -- <backup.sqlite>");
}

const backupPath = path.resolve(backupArgument);
if (!fs.existsSync(backupPath)) {
  throw new Error("Backup file does not exist");
}

const config = loadConfig();
const dbPath = resolveDbPath(config.dbPath);
if (path.resolve(dbPath) === backupPath) {
  throw new Error("Backup and destination paths must differ");
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const temporaryPath = `${dbPath}.restore-${process.pid}-${Date.now()}`;
const backup = new Database(backupPath, {
  readonly: true,
  fileMustExist: true,
});

try {
  const check = backup.pragma("quick_check", { simple: true });
  if (check !== "ok") throw new Error("Backup failed SQLite integrity check");
  await backup.backup(temporaryPath);
} finally {
  backup.close();
}

try {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.renameSync(temporaryPath, dbPath);
  console.log(`Database restored from: ${backupPath}`);
} finally {
  fs.rmSync(temporaryPath, { force: true });
}
