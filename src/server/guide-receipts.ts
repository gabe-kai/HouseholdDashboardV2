import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { nowUtcIso } from "../domain/time.js";
import { memberAccessFail } from "./member-access.js";

export type GuideMutationKind =
  | "guide_person_create"
  | "guide_people_complete"
  | "guide_school"
  | "guide_work"
  | "guide_finish"
  | "guide_dismiss";

export type GuideReceiptScope = {
  householdId: string;
  actorMembershipId: string;
  installationEpoch: number;
};

export function guidePayloadDigest(normalized: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

export function readGuideMutationReceipt(
  db: Database.Database,
  mutationId: string,
  kind: GuideMutationKind,
  scope: GuideReceiptScope,
  digest: string,
): unknown | null {
  const row = db
    .prepare(
      `SELECT household_id, actor_membership_id, installation_epoch, kind, payload_digest, response_json
       FROM guide_mutation_receipts WHERE mutation_id = ?`,
    )
    .get(mutationId) as
    | {
        household_id: string;
        actor_membership_id: string;
        installation_epoch: number;
        kind: string;
        payload_digest: string;
        response_json: string;
      }
    | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.response_json) as unknown;
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as { retired?: unknown }).retired === true
  ) {
    memberAccessFail("CONFLICT", "This request was retired and cannot be replayed");
  }
  if (
    row.household_id !== scope.householdId ||
    row.actor_membership_id !== scope.actorMembershipId ||
    row.installation_epoch !== scope.installationEpoch ||
    row.kind !== kind ||
    row.payload_digest !== digest
  ) {
    memberAccessFail(
      "CONFLICT",
      "Guide command does not match the original saved request",
    );
  }
  return parsed;
}

export function writeGuideMutationReceipt(
  db: Database.Database,
  mutationId: string,
  kind: GuideMutationKind,
  scope: GuideReceiptScope,
  digest: string,
  response: unknown,
): void {
  db.prepare(
    `INSERT INTO guide_mutation_receipts
     (mutation_id, household_id, actor_membership_id, installation_epoch, kind, payload_digest, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    mutationId,
    scope.householdId,
    scope.actorMembershipId,
    scope.installationEpoch,
    kind,
    digest,
    JSON.stringify(response),
    nowUtcIso(),
  );
}

/** Retire guide receipts that solely reference a deleted unused membership. */
export function retireGuideReceiptsForMembership(
  db: Database.Database,
  membershipId: string,
): void {
  const rows = db
    .prepare(`SELECT mutation_id, response_json FROM guide_mutation_receipts`)
    .all() as Array<{ mutation_id: string; response_json: string }>;
  const retire = db.prepare(
    `UPDATE guide_mutation_receipts SET response_json = ? WHERE mutation_id = ?`,
  );
  for (const row of rows) {
    if (row.response_json.includes(membershipId)) {
      retire.run(JSON.stringify({ retired: true }), row.mutation_id);
    }
  }
}

/** Retire guide receipts that solely reference a deleted work definition. */
export function retireGuideReceiptsForWorkDefinition(
  db: Database.Database,
  definitionId: string,
): void {
  const rows = db
    .prepare(`SELECT mutation_id, response_json FROM guide_mutation_receipts`)
    .all() as Array<{ mutation_id: string; response_json: string }>;
  const retire = db.prepare(
    `UPDATE guide_mutation_receipts SET response_json = ? WHERE mutation_id = ?`,
  );
  for (const row of rows) {
    if (row.response_json.includes(definitionId)) {
      retire.run(JSON.stringify({ retired: true }), row.mutation_id);
    }
  }
}
