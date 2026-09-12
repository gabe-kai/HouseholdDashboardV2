/**
 * Provenance-safe demo fixture cleanup (P0-004A r3).
 * Dry-run by default. Exact manifest IDs only — never display names.
 *
 * Usage:
 *   npm run db:cleanup-fixtures -- [--db path] [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";
import { openDatabase, resolveDbPath } from "../db.js";
import { FIXTURE_MEMBER_IDS, SEED } from "../seeds/evaluation.js";

type BlockReason =
  | "not_pending"
  | "has_user"
  | "has_session"
  | "has_enrollment_claim"
  | "has_revision_assignment"
  | "has_occurrence"
  | "has_step_report"
  | "has_personal_layer"
  | "has_proposal"
  | "has_personal_task"
  | "has_group_membership"
  | "missing_membership";

type CandidateReport = {
  membershipId: string;
  status: "candidate" | "blocked" | "absent";
  blockers: BlockReason[];
};

function parseArgs(argv: string[]) {
  let dbPath: string | undefined;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--apply") apply = true;
    else if (arg === "--db") {
      dbPath = argv[++i];
    } else if (arg.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length);
    }
  }
  return { dbPath, apply };
}

function evaluateMembership(
  db: ReturnType<typeof openDatabase>,
  membershipId: string,
  householdId: string,
): CandidateReport {
  const row = db
    .prepare(
      `SELECT id, status, user_id FROM household_memberships
       WHERE id = ? AND household_id = ?`,
    )
    .get(membershipId, householdId) as
    | { id: string; status: string; user_id: string | null }
    | undefined;
  if (!row) {
    return { membershipId, status: "absent", blockers: ["missing_membership"] };
  }
  const blockers: BlockReason[] = [];
  if (row.status !== "pending") blockers.push("not_pending");
  if (row.user_id) blockers.push("has_user");
  if (
    db.prepare("SELECT 1 FROM auth_sessions WHERE membership_id = ? LIMIT 1").get(membershipId)
  ) {
    blockers.push("has_session");
  }
  if (
    db
      .prepare("SELECT 1 FROM enrollment_claims WHERE membership_id = ? LIMIT 1")
      .get(membershipId)
  ) {
    blockers.push("has_enrollment_claim");
  }
  if (
    db.prepare("SELECT 1 FROM revision_assignees WHERE member_id = ? LIMIT 1").get(membershipId)
  ) {
    blockers.push("has_revision_assignment");
  }
  if (
    db
      .prepare("SELECT 1 FROM occurrences WHERE accountable_member_id = ? LIMIT 1")
      .get(membershipId)
  ) {
    blockers.push("has_occurrence");
  }
  if (
    db
      .prepare(
        `SELECT 1 FROM step_reports
         WHERE accountable_member_id = ? OR acting_member_id = ? LIMIT 1`,
      )
      .get(membershipId, membershipId)
  ) {
    blockers.push("has_step_report");
  }
  if (
    db
      .prepare("SELECT 1 FROM personal_routine_revisions WHERE membership_id = ? LIMIT 1")
      .get(membershipId)
  ) {
    blockers.push("has_personal_layer");
  }
  if (
    db
      .prepare(
        `SELECT 1 FROM routine_proposals
         WHERE membership_id = ? OR decider_membership_id = ? LIMIT 1`,
      )
      .get(membershipId, membershipId)
  ) {
    blockers.push("has_proposal");
  }
  if (
    db
      .prepare("SELECT 1 FROM personal_tasks WHERE owner_membership_id = ? LIMIT 1")
      .get(membershipId)
  ) {
    blockers.push("has_personal_task");
  }
  if (
    db
      .prepare("SELECT 1 FROM household_group_members WHERE membership_id = ? LIMIT 1")
      .get(membershipId)
  ) {
    blockers.push("has_group_membership");
  }
  return {
    membershipId,
    status: blockers.length === 0 ? "candidate" : "blocked",
    blockers,
  };
}

function removeSafeMembership(db: ReturnType<typeof openDatabase>, membershipId: string): void {
  db.prepare("DELETE FROM membership_grants WHERE membership_id = ?").run(membershipId);
  db.prepare("DELETE FROM household_memberships WHERE id = ?").run(membershipId);
  db.prepare("DELETE FROM members WHERE id = ?").run(membershipId);
}

async function main() {
  const { dbPath: overridePath, apply } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const dbPath = resolveDbPath(overridePath ?? config.dbPath);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database does not exist: ${dbPath}`);
  }

  const db = openDatabase(dbPath);
  try {
    const reports = FIXTURE_MEMBER_IDS.map((id) =>
      evaluateMembership(db, id, SEED.household.id),
    );
    const candidates = reports.filter((r) => r.status === "candidate");
    const blocked = reports.filter((r) => r.status === "blocked");
    const absent = reports.filter((r) => r.status === "absent");

    const summary = {
      mode: apply ? "apply" : "dry-run",
      dbPath,
      householdId: SEED.household.id,
      candidateCount: candidates.length,
      blockedCount: blocked.length,
      absentCount: absent.length,
      candidates: candidates.map((r) => r.membershipId),
      blocked: blocked.map((r) => ({
        membershipId: r.membershipId,
        blockers: r.blockers,
      })),
      removed: [] as string[],
      backupPath: null as string | null,
    };

    if (!apply) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const backupDir = path.resolve(config.backupDir);
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const backupPath = path.join(backupDir, `household-pre-fixture-cleanup-${timestamp}.sqlite`);
    try {
      await db.backup(backupPath);
    } catch (error) {
      throw new Error(
        `Backup failed; no memberships removed (${error instanceof Error ? error.message : "unknown"})`,
      );
    }
    summary.backupPath = backupPath;

    const removed: string[] = [];
    const tx = db.transaction(() => {
      for (const id of FIXTURE_MEMBER_IDS) {
        const again = evaluateMembership(db, id, SEED.household.id);
        if (again.status !== "candidate") continue;
        removeSafeMembership(db, id);
        removed.push(id);
      }
    });
    tx();
    summary.removed = removed;
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
