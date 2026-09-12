/**
 * Provenance-safe demo fixture cleanup (P0-004A r3).
 * Dry-run by default. Exact manifest IDs only — never display names.
 *
 * Usage:
 *   npm run db:cleanup-fixtures -- [--db path] [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { loadConfig } from "../config.js";
import { openDatabase, resolveDbPath } from "../db.js";
import { FIXTURE_MEMBER_IDS, SEED } from "../seeds/evaluation.js";

export type BlockReason =
  | "not_pending"
  | "has_user"
  | "has_session"
  | "has_legacy_session"
  | "has_enrollment_claim"
  | "has_enrollment_authorship"
  | "has_revision_assignment"
  | "has_occurrence"
  | "has_step_report"
  | "has_personal_layer"
  | "has_proposal"
  | "has_personal_task"
  | "has_group_membership"
  | "has_structure_receipt"
  | "has_mutation_receipt"
  | "missing_membership";

export type CandidateReport = {
  membershipId: string;
  status: "candidate" | "blocked" | "absent";
  blockers: BlockReason[];
};

export type CleanupSummary = {
  mode: "dry-run" | "apply";
  dbPath: string;
  householdId: string;
  candidateCount: number;
  blockedCount: number;
  absentCount: number;
  candidates: string[];
  blocked: Array<{ membershipId: string; blockers: BlockReason[] }>;
  removed: string[];
  backupPath: string | null;
};

export type CleanupOptions = {
  dbPath: string;
  apply?: boolean;
  backupDir: string;
  /** Override for tests (e.g. simulate backup failure). */
  backup?: (db: Database.Database, destPath: string) => Promise<void>;
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

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function jsonMentionsMembership(db: Database.Database, table: string, membershipId: string): boolean {
  if (!tableExists(db, table)) return false;
  // Identity-bearing replay/audit payloads store membership ids inside JSON.
  const rows = db.prepare(`SELECT response_json FROM ${table}`).all() as Array<{
    response_json: string;
  }>;
  return rows.some((row) => row.response_json.includes(membershipId));
}

export function evaluateMembership(
  db: Database.Database,
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
    tableExists(db, "sessions") &&
    db.prepare("SELECT 1 FROM sessions WHERE member_id = ? LIMIT 1").get(membershipId)
  ) {
    blockers.push("has_legacy_session");
  }
  if (
    db
      .prepare("SELECT 1 FROM enrollment_claims WHERE membership_id = ? LIMIT 1")
      .get(membershipId)
  ) {
    blockers.push("has_enrollment_claim");
  }
  if (
    db
      .prepare(
        "SELECT 1 FROM enrollment_claims WHERE created_by_membership_id = ? LIMIT 1",
      )
      .get(membershipId)
  ) {
    blockers.push("has_enrollment_authorship");
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
  if (jsonMentionsMembership(db, "structure_mutation_receipts", membershipId)) {
    blockers.push("has_structure_receipt");
  }
  if (jsonMentionsMembership(db, "mutation_receipts", membershipId)) {
    blockers.push("has_mutation_receipt");
  }
  return {
    membershipId,
    status: blockers.length === 0 ? "candidate" : "blocked",
    blockers,
  };
}

function removeSafeMembership(db: Database.Database, membershipId: string): void {
  db.prepare("DELETE FROM membership_grants WHERE membership_id = ?").run(membershipId);
  db.prepare("DELETE FROM household_memberships WHERE id = ?").run(membershipId);
  db.prepare("DELETE FROM members WHERE id = ?").run(membershipId);
}

export async function runFixtureCleanup(options: CleanupOptions): Promise<CleanupSummary> {
  const apply = options.apply === true;
  const dbPath = resolveDbPath(options.dbPath);
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

    const summary: CleanupSummary = {
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
      removed: [],
      backupPath: null,
    };

    if (!apply) return summary;

    const backupDir = path.resolve(options.backupDir);
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const backupPath = path.join(backupDir, `household-pre-fixture-cleanup-${timestamp}.sqlite`);
    const backupFn =
      options.backup ??
      (async (database: Database.Database, dest: string) => {
        await database.backup(dest);
      });
    try {
      await backupFn(db, backupPath);
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
    return summary;
  } finally {
    db.close();
  }
}

async function main() {
  const { dbPath: overridePath, apply } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const dbPath = resolveDbPath(overridePath ?? config.dbPath);
  const summary = await runFixtureCleanup({
    dbPath,
    apply,
    backupDir: config.backupDir,
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
