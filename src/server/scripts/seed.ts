import { loadConfig } from "../config.js";
import { migrate, openDatabase, resolveDbPath } from "../db.js";
import { AppStore } from "../store.js";

const config = loadConfig();
const dbPath = resolveDbPath(config.dbPath);
const db = openDatabase(dbPath);
migrate(db);
const store = new AppStore(db);
store.seed(config.householdTimezone);
db.close();
console.log(`Seeded evaluation household at ${dbPath} (timezone=${config.householdTimezone})`);
