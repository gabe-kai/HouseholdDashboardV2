import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { openDatabase, resolveDbPath } from "../db.js";

const config = loadConfig();
const dbPath = resolveDbPath(config.dbPath);
if (!fs.existsSync(dbPath)) {
  throw new Error("Database file does not exist");
}
const backupDir = path.resolve(config.backupDir);
fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-");
const backupPath = path.join(backupDir, `household-${timestamp}.sqlite`);
const db = openDatabase(dbPath);

try {
  await db.backup(backupPath);
  console.log(`Backup created: ${backupPath}`);
} finally {
  db.close();
}
