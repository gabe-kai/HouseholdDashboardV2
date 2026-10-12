import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  GRANT_PRESETS,
  MEMBER_DEFAULT_GRANTS,
  SECONDARY_EDITABLE_GRANTS,
  deriveRoleLabel,
  isEssentialManagerGrants,
  mergePermissionGrants,
} from "../shared/grants.js";
import type {
  AccessClaimPurpose,
  AccessState,
  AuthorityRole,
  Grant,
  MemberPersonalizeMode,
  MemberPublic,
  PersonClassification,
} from "../shared/schemas.js";
import { GrantSchema } from "../shared/schemas.js";
import { digestEquals, randomToken, sha256Hex } from "./crypto.js";
import { evaluateMembership } from "./scripts/cleanup-fixtures.js";
import { FIXTURE_MEMBER_IDS, SEED } from "./seeds/evaluation.js";
import { nowUtcIso, type HouseholdDate } from "../domain/time.js";

export type StructureMutationReceiptKind =
  | "person_create"
  | "group_create"
  | "setup_issue"
  | "permission_save"
  | "access_claim_issue"
  | "access_claim_cancel"
  | "sign_in_revoke"
  | "member_remove"
  | "fixture_remediation"
  | "password_change";

export const INVITATION_CLAIM_MS = 24 * 60 * 60 * 1_000;
export const PASSWORD_RESET_CLAIM_MS = 30 * 60 * 1_000;
export const RESTORE_SIGN_IN_CLAIM_MS = 24 * 60 * 60 * 1_000;

const KNOWN_GRANT_SET = new Set<string>(GrantSchema.options);

export type MemberAccessErrorCode =
  | "VALIDATION"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED";

export function memberAccessFail(
  code: MemberAccessErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): never {
  throw Object.assign(new Error(message), { code, ...extra });
}

export function grantsForMembership(db: Database.Database, membershipId: string): string[] {
  return (
    db
      .prepare(
        "SELECT grant_name FROM membership_grants WHERE membership_id = ? ORDER BY grant_name",
      )
      .all(membershipId) as Array<{ grant_name: string }>
  ).map((row) => row.grant_name);
}

export function replaceGrants(
  db: Database.Database,
  membershipId: string,
  grants: readonly string[],
): void {
  db.prepare("DELETE FROM membership_grants WHERE membership_id = ?").run(membershipId);
  const insert = db.prepare(
    "INSERT INTO membership_grants (membership_id, grant_name) VALUES (?, ?)",
  );
  for (const grant of grants) insert.run(membershipId, grant);
}

export function isMemberDeparted(db: Database.Database, membershipId: string): boolean {
  const row = db
    .prepare(`SELECT departed_at FROM household_memberships WHERE id = ?`)
    .get(membershipId) as { departed_at: string | null } | undefined;
  return Boolean(row?.departed_at);
}

export function isMemberEligible(
  db: Database.Database,
  householdId: string,
  memberId: string,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM household_memberships
       WHERE id = ? AND household_id = ? AND departed_at IS NULL`,
    )
    .get(memberId, householdId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

type MembershipSignInRow = {
  id: string;
  household_id: string;
  user_id: string | null;
  status: "active" | "pending";
  sign_in_revoked_at: string | null;
  departed_at: string | null;
  disabled: number | null;
};

function loadMembershipSignInRow(
  db: Database.Database,
  membershipId: string,
): MembershipSignInRow | undefined {
  return db
    .prepare(
      `SELECT hm.id, hm.household_id, hm.user_id, hm.status, hm.sign_in_revoked_at,
              hm.departed_at, u.disabled
       FROM household_memberships hm
       LEFT JOIN users u ON u.id = hm.user_id
       WHERE hm.id = ?`,
    )
    .get(membershipId) as MembershipSignInRow | undefined;
}

/** Active sign-in-enabled user counts toward essential-manager continuity. */
export function membershipCountsForEssentialManager(
  db: Database.Database,
  membershipId: string,
): boolean {
  const row = loadMembershipSignInRow(db, membershipId);
  if (!row || row.status !== "active" || row.departed_at) return false;
  if (!row.user_id || row.disabled !== 0) return false;
  if (row.sign_in_revoked_at) return false;
  return isEssentialManagerGrants(grantsForMembership(db, membershipId));
}

export function countEssentialManagers(
  db: Database.Database,
  householdId: string,
): number {
  const rows = db
    .prepare(
      `SELECT hm.id FROM household_memberships hm
       WHERE hm.household_id = ? AND hm.status = 'active' AND hm.departed_at IS NULL`,
    )
    .all(householdId) as Array<{ id: string }>;
  let count = 0;
  for (const row of rows) {
    if (membershipCountsForEssentialManager(db, row.id)) count += 1;
  }
  return count;
}

export function hasActiveLifecycleManager(db: Database.Database): boolean {
  return countEssentialManagers(
    db,
    (
      db.prepare(`SELECT id FROM households ORDER BY id LIMIT 1`).get() as
        | { id: string }
        | undefined
    )?.id ?? "",
  ) > 0;
}

export function assertEssentialManagerSurvives(
  db: Database.Database,
  householdId: string,
  input:
    | { nextGrantMap: ReadonlyMap<string, readonly string[]> }
    | { removedMembershipIds: readonly string[] },
): void {
  const rows = db
    .prepare(
      `SELECT hm.id FROM household_memberships hm
       WHERE hm.household_id = ? AND hm.status = 'active' AND hm.departed_at IS NULL`,
    )
    .all(householdId) as Array<{ id: string }>;

  const removed = "removedMembershipIds" in input ? new Set(input.removedMembershipIds) : null;
  const grantMap = "nextGrantMap" in input ? input.nextGrantMap : null;

  let essential = 0;
  for (const row of rows) {
    if (removed?.has(row.id)) continue;
    const rowData = loadMembershipSignInRow(db, row.id);
    if (!rowData?.user_id || rowData.disabled !== 0 || rowData.sign_in_revoked_at) {
      continue;
    }
    const grants = grantMap?.has(row.id)
      ? [...(grantMap.get(row.id) ?? [])]
      : grantsForMembership(db, row.id);
    if (isEssentialManagerGrants(grants)) essential += 1;
  }
  if (essential < 1) {
    memberAccessFail(
      "FORBIDDEN",
      "At least one active essential manager must remain for household administration",
    );
  }
}

export function issuerHasEnrollmentAuthority(
  db: Database.Database,
  membershipId: string | null,
  householdId: string,
): boolean {
  if (!membershipId) return true;
  const row = loadMembershipSignInRow(db, membershipId);
  if (
    !row ||
    row.household_id !== householdId ||
    row.status !== "active" ||
    row.departed_at
  ) {
    return false;
  }
  return grantsForMembership(db, membershipId).includes("household.member.enroll");
}

export type AccessMeta = {
  state: AccessState;
  setupClaimId: string | null;
  setupCreatedAt: string | null;
  setupExpiresAt: string | null;
  purpose: AccessClaimPurpose | null;
};

function latestOpenAccessClaim(
  db: Database.Database,
  membershipId: string,
  purpose: AccessClaimPurpose,
  nowIso: string,
): { id: string; created_at: string; expires_at: string } | undefined {
  return db
    .prepare(
      `SELECT id, created_at, expires_at FROM membership_access_claims
       WHERE membership_id = ? AND purpose = ?
         AND consumed_at IS NULL AND revoked_at IS NULL
         AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(membershipId, purpose, nowIso) as
    | { id: string; created_at: string; expires_at: string }
    | undefined;
}

function latestAccessClaimAnyState(
  db: Database.Database,
  membershipId: string,
  purpose: AccessClaimPurpose,
): { id: string; created_at: string; expires_at: string; consumed_at: string | null } | undefined {
  return db
    .prepare(
      `SELECT id, created_at, expires_at, consumed_at FROM membership_access_claims
       WHERE membership_id = ? AND purpose = ? AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(membershipId, purpose) as
    | { id: string; created_at: string; expires_at: string; consumed_at: string | null }
    | undefined;
}

export function accessMetaForMembership(
  db: Database.Database,
  membershipId: string,
  now = new Date(),
): AccessMeta {
  const membership = loadMembershipSignInRow(db, membershipId);
  if (!membership) {
    return {
      state: "not_set_up",
      setupClaimId: null,
      setupCreatedAt: null,
      setupExpiresAt: null,
      purpose: null,
    };
  }

  if (membership.user_id && membership.sign_in_revoked_at) {
    return {
      state: "access_revoked",
      setupClaimId: null,
      setupCreatedAt: null,
      setupExpiresAt: null,
      purpose: null,
    };
  }

  if (membership.user_id && membership.disabled === 0) {
    return {
      state: "access_set_up",
      setupClaimId: null,
      setupCreatedAt: null,
      setupExpiresAt: null,
      purpose: null,
    };
  }

  const nowIso = now.toISOString();
  for (const purpose of ["invitation", "restore_sign_in"] as const) {
    const actionable = latestOpenAccessClaim(db, membershipId, purpose, nowIso);
    if (actionable) {
      return {
        state: "setup_ready",
        setupClaimId: actionable.id,
        setupCreatedAt: actionable.created_at,
        setupExpiresAt: actionable.expires_at,
        purpose,
      };
    }
  }

  for (const purpose of ["invitation", "restore_sign_in"] as const) {
    const latest = latestAccessClaimAnyState(db, membershipId, purpose);
    if (latest && !latest.consumed_at && new Date(latest.expires_at) <= now) {
      return {
        state: "setup_expired",
        setupClaimId: latest.id,
        setupCreatedAt: latest.created_at,
        setupExpiresAt: latest.expires_at,
        purpose,
      };
    }
  }

  // Legacy enrollment_claims path
  const legacyActionable = db
    .prepare(
      `SELECT id, created_at, expires_at FROM enrollment_claims
       WHERE membership_id = ? AND kind = 'enrollment'
         AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(membershipId, nowIso) as
    | { id: string; created_at: string; expires_at: string }
    | undefined;
  if (legacyActionable) {
    return {
      state: "setup_ready",
      setupClaimId: legacyActionable.id,
      setupCreatedAt: legacyActionable.created_at,
      setupExpiresAt: legacyActionable.expires_at,
      purpose: "invitation",
    };
  }

  const legacyLatest = db
    .prepare(
      `SELECT id, created_at, expires_at, consumed_at FROM enrollment_claims
       WHERE membership_id = ? AND kind = 'enrollment' AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(membershipId) as
    | { id: string; created_at: string; expires_at: string; consumed_at: string | null }
    | undefined;
  if (
    legacyLatest &&
    !legacyLatest.consumed_at &&
    new Date(legacyLatest.expires_at) <= now
  ) {
    return {
      state: "setup_expired",
      setupClaimId: legacyLatest.id,
      setupCreatedAt: legacyLatest.created_at,
      setupExpiresAt: legacyLatest.expires_at,
      purpose: "invitation",
    };
  }

  return {
    state: "not_set_up",
    setupClaimId: null,
    setupCreatedAt: null,
    setupExpiresAt: null,
    purpose: null,
  };
}

export function toMemberPublicShape(
  db: Database.Database,
  row: {
    id: string;
    display_name: string;
    status: "active" | "pending";
    classification: PersonClassification | null;
    version: number;
    authority_version: number;
    sort_order: number;
    departed_at: string | null;
    sign_in_revoked_at: string | null;
  },
): MemberPublic {
  const grants = grantsForMembership(db, row.id);
  const accessMeta = accessMetaForMembership(db, row.id);
  return {
    id: row.id,
    displayName: row.display_name,
    status: row.status,
    classification: row.classification,
    version: row.version,
    authorityVersion: row.authority_version,
    sortOrder: row.sort_order,
    grants,
    accessState: accessMeta.state,
    roleLabel: deriveRoleLabel(grants),
    departed: Boolean(row.departed_at),
    signInRevoked: Boolean(row.sign_in_revoked_at),
  };
}

export function claimExpiryMs(purpose: AccessClaimPurpose): number {
  if (purpose === "password_reset") return PASSWORD_RESET_CLAIM_MS;
  if (purpose === "restore_sign_in") return RESTORE_SIGN_IN_CLAIM_MS;
  return INVITATION_CLAIM_MS;
}

export function revokeOpenAccessClaims(
  db: Database.Database,
  membershipId: string,
  purpose: AccessClaimPurpose | undefined,
  revokedAt: string,
): void {
  if (purpose) {
    db.prepare(
      `UPDATE membership_access_claims
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE membership_id = ? AND purpose = ?
         AND consumed_at IS NULL AND revoked_at IS NULL`,
    ).run(revokedAt, membershipId, purpose);
    return;
  }
  db.prepare(
    `UPDATE membership_access_claims
     SET revoked_at = COALESCE(revoked_at, ?)
     WHERE membership_id = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
  ).run(revokedAt, membershipId);
}

export function revokeOpenEnrollmentClaims(
  db: Database.Database,
  membershipId: string,
  revokedAt: string,
): void {
  db.prepare(
    `UPDATE enrollment_claims
     SET revoked_at = COALESCE(revoked_at, ?)
     WHERE membership_id = ? AND consumed_at IS NULL AND revoked_at IS NULL`,
  ).run(revokedAt, membershipId);
}

export function insertAccessClaim(
  db: Database.Database,
  input: {
    householdId: string;
    membershipId: string;
    purpose: AccessClaimPurpose;
    creatorMembershipId: string;
  },
): { claimId: string; token: string; expiresAt: string } {
  const token = randomToken();
  const claimId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + claimExpiryMs(input.purpose)).toISOString();
  db.prepare(
    `INSERT INTO membership_access_claims
     (id, household_id, membership_id, purpose, token_digest, created_by_membership_id,
      created_at, expires_at, consumed_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    claimId,
    input.householdId,
    input.membershipId,
    input.purpose,
    sha256Hex(token),
    input.creatorMembershipId,
    now.toISOString(),
    expiresAt,
  );
  return { claimId, token, expiresAt };
}

export function findAccessClaimByToken(
  db: Database.Database,
  claimToken: string,
):
  | {
      id: string;
      household_id: string;
      membership_id: string;
      purpose: AccessClaimPurpose;
      token_digest: string;
      expires_at: string;
      created_by_membership_id: string | null;
      consumed_at: string | null;
      revoked_at: string | null;
    }
  | undefined {
  const digest = sha256Hex(claimToken);
  return db
    .prepare(`SELECT * FROM membership_access_claims WHERE token_digest = ?`)
    .get(digest) as
    | {
        id: string;
        household_id: string;
        membership_id: string;
        purpose: AccessClaimPurpose;
        token_digest: string;
        expires_at: string;
        created_by_membership_id: string | null;
        consumed_at: string | null;
        revoked_at: string | null;
      }
    | undefined;
}

export function previewAccessClaimPayload(
  db: Database.Database,
  claimToken: string,
): {
  householdName: string;
  personDisplayName: string;
  purpose: AccessClaimPurpose;
  expiresAt: string;
} {
  const digest = sha256Hex(claimToken);
  const claim = findAccessClaimByToken(db, claimToken);
  if (
    !claim ||
    !digestEquals(claim.token_digest, digest) ||
    claim.consumed_at ||
    claim.revoked_at ||
    new Date(claim.expires_at) <= new Date()
  ) {
    memberAccessFail("UNAUTHORIZED", "Claim is invalid or expired");
  }
  const validated = claim;
  if (
    validated.created_by_membership_id &&
    !issuerHasEnrollmentAuthority(
      db,
      validated.created_by_membership_id,
      validated.household_id,
    )
  ) {
    memberAccessFail("UNAUTHORIZED", "Claim is invalid or expired");
  }
  const household = db
    .prepare(`SELECT name FROM households WHERE id = ?`)
    .get(validated.household_id) as { name: string } | undefined;
  const person = db
    .prepare(`SELECT display_name FROM household_memberships WHERE id = ?`)
    .get(validated.membership_id) as { display_name: string } | undefined;
  if (!household || !person) memberAccessFail("NOT_FOUND", "Claim target not found");
  if (isMemberDeparted(db, validated.membership_id)) {
    memberAccessFail("UNAUTHORIZED", "Claim is invalid or expired");
  }
  return {
    householdName: household.name,
    personDisplayName: person.display_name,
    purpose: validated.purpose,
    expiresAt: validated.expires_at,
  };
}

export function unknownGrants(grants: readonly string[]): string[] {
  return grants.filter((g) => !KNOWN_GRANT_SET.has(g));
}

export function mergedPermissionsFromInput(input: {
  role: AuthorityRole;
  memberMode?: MemberPersonalizeMode;
  secondaryGrants: readonly string[];
  priorGrants: readonly string[];
}): string[] {
  return mergePermissionGrants({
    role: input.role,
    memberMode: input.memberMode,
    secondaryGrants: input.secondaryGrants,
    priorGrants: input.priorGrants,
    knownGrants: [...KNOWN_GRANT_SET],
  });
}

export function bumpAuthorityVersion(
  db: Database.Database,
  membershipId: string,
  expectedAuthorityVersion: number,
): number {
  const row = db
    .prepare(`SELECT authority_version FROM household_memberships WHERE id = ?`)
    .get(membershipId) as { authority_version: number } | undefined;
  if (!row) memberAccessFail("NOT_FOUND", "Person not found");
  if (row.authority_version !== expectedAuthorityVersion) {
    memberAccessFail("CONFLICT", "Permissions were updated elsewhere; re-read and try again");
  }
  const next = row.authority_version + 1;
  db.prepare(`UPDATE household_memberships SET authority_version = ? WHERE id = ?`).run(
    next,
    membershipId,
  );
  return next;
}

export function membershipHasAnyGrants(
  db: Database.Database,
  membershipId: string,
): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM membership_grants WHERE membership_id = ? LIMIT 1`)
    .get(membershipId) as { ok: number } | undefined;
  return Boolean(row?.ok);
}

export function resolveClaimGrants(
  db: Database.Database,
  membershipId: string | null,
  presetGrants: readonly Grant[],
): readonly Grant[] {
  if (!membershipId) return presetGrants;
  if (membershipHasAnyGrants(db, membershipId)) {
    return grantsForMembership(db, membershipId) as Grant[];
  }
  return presetGrants;
}

export function digestPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function cancelUnstartedOccurrencesForMember(
  db: Database.Database,
  householdId: string,
  membershipId: string,
  fromDate: HouseholdDate,
  canceledAt: string,
): number {
  const result = db
    .prepare(
      `UPDATE occurrences
       SET canceled_at = ?
       WHERE household_id = ? AND accountable_member_id = ?
         AND household_date >= ? AND started_at IS NULL AND canceled_at IS NULL`,
    )
    .run(canceledAt, householdId, membershipId, fromDate);
  return result.changes;
}

/** Receipt kinds whose payload is solely about one person's profile/setup/access. */
const RETIRABLE_SETUP_RECEIPT_KINDS = new Set<string>([
  "person_create",
  "setup_issue",
  "permission_save",
  "access_claim_issue",
  "access_claim_cancel",
]);

export function physicallyDeleteUnusedMembership(
  db: Database.Database,
  membershipId: string,
  householdId: string,
): void {
  const report = evaluateMembership(db, membershipId, householdId);
  // Setup/profile receipts solely owned by this person are retired below rather than
  // making every new person permanently undeletable.
  const hardBlockers = report.blockers.filter((b) => b !== "has_structure_receipt");
  if (report.status === "absent" || hardBlockers.length > 0) {
    memberAccessFail(
      "CONFLICT",
      "This person cannot be deleted because they are referenced or in use",
      { blockers: hardBlockers },
    );
  }
  const receiptRows = db
    .prepare(`SELECT mutation_id, kind, response_json FROM structure_mutation_receipts`)
    .all() as Array<{ mutation_id: string; kind: string; response_json: string }>;
  const owned = receiptRows.filter((r) => r.response_json.includes(membershipId));
  for (const row of owned) {
    if (!RETIRABLE_SETUP_RECEIPT_KINDS.has(row.kind)) {
      memberAccessFail(
        "CONFLICT",
        "This person cannot be deleted because they are referenced or in use",
        { blockers: ["has_structure_receipt"] },
      );
    }
  }
  const retire = db.prepare(
    `UPDATE structure_mutation_receipts SET response_json = ? WHERE mutation_id = ?`,
  );
  for (const row of owned) retire.run(JSON.stringify({ retired: true }), row.mutation_id);
  db.prepare("DELETE FROM membership_access_claims WHERE membership_id = ?").run(membershipId);
  db.prepare("DELETE FROM membership_grants WHERE membership_id = ?").run(membershipId);
  db.prepare("DELETE FROM household_memberships WHERE id = ?").run(membershipId);
  db.prepare("DELETE FROM members WHERE id = ?").run(membershipId);
}

export function markMembershipDeparted(
  db: Database.Database,
  membershipId: string,
  departedAt: string,
  departedHouseholdDate: HouseholdDate,
): void {
  db.prepare(
    `UPDATE household_memberships
     SET departed_at = ?, departed_household_date = ?, sign_in_revoked_at = COALESCE(sign_in_revoked_at, ?)
     WHERE id = ?`,
  ).run(departedAt, departedHouseholdDate, departedAt, membershipId);
}

export type FixtureRemediationCandidate = {
  membershipId: string;
  displayName: string;
  preselected: boolean;
  disposable: boolean;
  blockers: string[];
};

export function fixtureRemediationCandidates(
  db: Database.Database,
  householdId: string,
): FixtureRemediationCandidate[] {
  if (householdId !== SEED.household.id) return [];
  const results: FixtureRemediationCandidate[] = [];
  for (const fixtureId of FIXTURE_MEMBER_IDS) {
    const seedMember = SEED.members.find((m) => m.id === fixtureId);
    const row = db
      .prepare(
        `SELECT id, display_name, status, user_id FROM household_memberships
         WHERE id = ? AND household_id = ?`,
      )
      .get(fixtureId, householdId) as
      | {
          id: string;
          display_name: string;
          status: string;
          user_id: string | null;
        }
      | undefined;
    if (!row) continue;
    const evaluation = evaluateMembership(db, fixtureId, householdId);
    const nameMatches = seedMember ? row.display_name === seedMember.displayName : false;
    const preselected =
      row.status === "pending" &&
      !row.user_id &&
      nameMatches &&
      evaluation.status === "candidate";
    results.push({
      membershipId: fixtureId,
      displayName: row.display_name,
      preselected,
      disposable: evaluation.status === "candidate",
      blockers: evaluation.blockers,
    });
  }
  return results;
}

export function readStructureReceipt(
  db: Database.Database,
  mutationId: string,
  kind: StructureMutationReceiptKind,
): unknown | null {
  const row = db
    .prepare(
      `SELECT response_json FROM structure_mutation_receipts
       WHERE mutation_id = ? AND kind = ?`,
    )
    .get(mutationId, kind) as { response_json: string } | undefined;
  if (!row) return null;
  const parsed = JSON.parse(row.response_json) as unknown;
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as { retired?: unknown }).retired === true
  ) {
    // Non-content-bearing denial left behind when an unused person was physically deleted.
    memberAccessFail("CONFLICT", "This request was retired and cannot be replayed");
  }
  return parsed;
}

export function writeStructureReceipt(
  db: Database.Database,
  mutationId: string,
  kind: StructureMutationReceiptKind,
  response: unknown,
): void {
  db.prepare(
    `INSERT INTO structure_mutation_receipts
     (mutation_id, kind, response_json, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(mutationId, kind, JSON.stringify(response), nowUtcIso());
}

export { SECONDARY_EDITABLE_GRANTS, GRANT_PRESETS, MEMBER_DEFAULT_GRANTS };
