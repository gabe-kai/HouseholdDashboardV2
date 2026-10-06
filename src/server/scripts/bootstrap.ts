import { loadConfig } from "../config.js";
import { migrate, openDatabase } from "../db.js";
import { resolveActiveHouseholdDbPath } from "../lifecycle-runtime.js";
import { AppStore } from "../store.js";

const config = loadConfig();
if (config.installationOwnerSecret) {
  throw new Error(
    "Bootstrap claims are disabled when INSTALLATION_OWNER_SECRET is configured",
  );
}
const db = openDatabase(resolveActiveHouseholdDbPath(config));

try {
  migrate(db);
  const claim = new AppStore(db).issueBootstrapClaim(config.householdTimezone);
  console.log(`Bootstrap claim (shown once): ${claim.token}`);
  console.log(`Expires at: ${claim.expiresAt}`);
} finally {
  db.close();
}
