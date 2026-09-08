import { loadConfig } from "../config.js";
import { migrate, openDatabase, resolveDbPath } from "../db.js";

const config = loadConfig();
const db = openDatabase(resolveDbPath(config.dbPath));
migrate(db);
db.close();
console.log(`Migrations applied to ${resolveDbPath(config.dbPath)}`);
