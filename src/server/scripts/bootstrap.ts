import { loadConfig } from "../config.js";
import { migrate, openDatabase, resolveDbPath } from "../db.js";
import { AppStore } from "../store.js";

const config = loadConfig();
const db = openDatabase(resolveDbPath(config.dbPath));

try {
  migrate(db);
  const claim = new AppStore(db).issueBootstrapClaim(config.householdTimezone);
  console.log(`Bootstrap claim (shown once): ${claim.token}`);
  console.log(`Expires at: ${claim.expiresAt}`);
} finally {
  db.close();
}
