import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { mapLegacyCapabilities } from "../shared/grants.js";

/** Post-SQL backfill for P0-002: grants + stable logical item IDs. */
export function backfillAuthenticatedAuthority(db: Database.Database): void {
  const members = db
    .prepare("SELECT id, capabilities_json FROM members")
    .all() as Array<{ id: string; capabilities_json: string }>;

  const insertGrant = db.prepare(
    "INSERT OR IGNORE INTO membership_grants (membership_id, grant_name) VALUES (?, ?)",
  );

  for (const m of members) {
    const grants = mapLegacyCapabilities(m.capabilities_json);
    for (const g of grants) {
      insertGrant.run(m.id, g);
    }
  }

  const defs = db.prepare("SELECT id FROM routine_definitions").all() as Array<{ id: string }>;
  for (const def of defs) {
    const revisions = db
      .prepare(
        "SELECT id FROM routine_revisions WHERE definition_id = ? ORDER BY effective_date ASC",
      )
      .all(def.id) as Array<{ id: string }>;

    let prevByKey = new Map<string, string>();
    for (const rev of revisions) {
      const steps = db
        .prepare(
          "SELECT id, position, text, obligation, logical_item_id FROM revision_steps WHERE revision_id = ? ORDER BY position",
        )
        .all(rev.id) as Array<{
        id: string;
        position: number;
        text: string;
        obligation: string;
        logical_item_id: string | null;
      }>;

      const nextByKey = new Map<string, string>();
      for (const step of steps) {
        const key = `${step.text}\0${step.obligation}`;
        let logicalId = step.logical_item_id;
        if (!logicalId) {
          logicalId = prevByKey.get(key) ?? randomUUID();
          db.prepare("UPDATE revision_steps SET logical_item_id = ? WHERE id = ?").run(
            logicalId,
            step.id,
          );
        }
        nextByKey.set(key, logicalId);
      }
      prevByKey = nextByKey;
    }
  }
}
