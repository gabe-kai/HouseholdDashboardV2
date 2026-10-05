import { loadConfig } from "../config.js";
import { migrate, openDatabase } from "../db.js";
import { resolveActiveHouseholdDbPath } from "../lifecycle-runtime.js";

const config = loadConfig();
const dbPath = resolveActiveHouseholdDbPath(config);
const db = openDatabase(dbPath);
migrate(db);
db.close();
console.log(`Migrations applied to ${dbPath}`);
