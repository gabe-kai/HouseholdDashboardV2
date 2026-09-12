import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GRANT_PRESETS } from "../../src/shared/grants.js";
import { migrate, openDatabase } from "../../src/server/db.js";
import { AppStore, type AuthContext } from "../../src/server/store.js";
import {
  PASSPHRASE,
  authHeaders,
  claimManager,
  createHttpHarness,
  httpClaimManager,
  IDS,
  sessionFromResponse,
} from "../helpers/auth-fixture.js";
import {
  P001_FIXTURE_IDS,
  applyPopulatedP001Fixture,
} from "../helpers/p001-fixture.js";

const temps: string[] = [];

afterEach(() => {
  for (const p of temps.splice(0)) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
});

function freshStore() {
  const dbPath = path.join(
    os.tmpdir(),
    `hd-004a-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
  );
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed("America/New_York");
  return { store, db, dbPath };
}

describe("P0-004A people, groups, and access", () => {
  it("migrates classification unset and structure.manage only for enroll holders", () => {
    const dbPath = path.join(os.tmpdir(), `hd-004a-mig-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    applyPopulatedP001Fixture(db);
    migrate(db);
    migrate(db);

    const classifications = db
      .prepare("SELECT classification FROM household_memberships")
      .all() as Array<{ classification: string | null }>;
    expect(classifications.every((row) => row.classification === null)).toBe(true);

    const structureHolders = db
      .prepare(
        `SELECT membership_id FROM membership_grants
         WHERE grant_name = 'household.structure.manage' ORDER BY membership_id`,
      )
      .all() as Array<{ membership_id: string }>;
    const enrollHolders = db
      .prepare(
        `SELECT membership_id FROM membership_grants
         WHERE grant_name = 'household.member.enroll' ORDER BY membership_id`,
      )
      .all() as Array<{ membership_id: string }>;
    expect(structureHolders).toEqual(enrollHolders);
    expect(
      db
        .prepare("SELECT COUNT(*) as c FROM step_reports WHERE mutation_id = ?")
        .get(P001_FIXTURE_IDS.mutationId),
    ).toEqual({ c: 1 });
  });

  it("creates and edits people without access grants and preserves occurrence snapshots", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const mutationId = randomUUID();
    const elizabeth = store.createPerson(manager.context, {
      mutationId,
      displayName: "Elizabeth",
      classification: "child",
    });
    expect(
      store.createPerson(manager.context, {
        mutationId,
        displayName: "Elizabeth",
        classification: "child",
      }).id,
    ).toBe(elizabeth.id);
    expect(elizabeth.grants).toEqual([]);
    expect(elizabeth.accessState).toBe("not_set_up");
    expect(elizabeth.classification).toBe("child");

    const twin = store.createPerson(manager.context, {
      mutationId: randomUUID(),
      displayName: "Elizabeth",
      classification: "child",
    });
    expect(twin.id).not.toBe(elizabeth.id);

    store.createRoutine(manager.context, {
      title: "Morning Routine",
      assigneeMemberIds: [IDS.avery],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [{ text: "Make bed", obligation: "required" }],
    });
    await enrollAndClaimChild(store, manager.context, IDS.avery);
    const today = store.householdDateNow(manager.context);
    const occurrence = store.materializeForDate(manager.context, today)[0]!;
    const before = store.occurrenceSnapshotStructure(occurrence.id);

    store.updatePerson(manager.context, elizabeth.id, {
      displayName: "Liz",
      classification: "child",
      expectedVersion: elizabeth.version,
    });
    expect(store.occurrenceSnapshotStructure(occurrence.id)).toEqual(before);
    expect(store.getPersonDetail(manager.context, elizabeth.id).displayName).toBe("Liz");
  });

  it("covers access-state lifecycle, one-time secret, and replay without plaintext", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    const person = store.createPerson(manager.context, {
      mutationId: randomUUID(),
      displayName: "Sam",
      classification: "child",
    });
    expect(person.accessState).toBe("not_set_up");

    const mutationId = randomUUID();
    const first = store.issueEnrollmentClaim(manager.context, {
      mutationId,
      membershipId: person.id,
      preset: "proposal_personalizer",
    });
    expect(first.token).toBeTruthy();
    expect(first.secretAlreadyIssued).toBe(false);
    expect(first.accessState).toBe("setup_ready");
    const replay = store.issueEnrollmentClaim(manager.context, {
      mutationId,
      membershipId: person.id,
      preset: "proposal_personalizer",
    });
    expect(replay.token).toBeUndefined();
    expect(replay.secretAlreadyIssued).toBe(true);
    expect(replay.claimId).toBe(first.claimId);

    const detail = store.getPersonDetail(manager.context, person.id);
    expect(detail.access.state).toBe("setup_ready");
    expect(JSON.stringify(detail)).not.toContain(first.token);

    const replacement = store.issueEnrollmentClaim(manager.context, {
      mutationId: randomUUID(),
      membershipId: person.id,
      preset: "direct_personalizer",
    });
    expect(replacement.claimId).not.toBe(first.claimId);
    const revoked = db
      .prepare("SELECT revoked_at FROM enrollment_claims WHERE id = ?")
      .get(first.claimId) as { revoked_at: string | null };
    expect(revoked.revoked_at).toBeTruthy();

    store.cancelEnrollmentSetup(manager.context, person.id);
    expect(store.getPersonDetail(manager.context, person.id).access.state).toBe("not_set_up");

    const expiredSetup = store.issueEnrollmentClaim(manager.context, {
      mutationId: randomUUID(),
      membershipId: person.id,
      preset: "proposal_personalizer",
    });
    db.prepare("UPDATE enrollment_claims SET expires_at = ? WHERE id = ?").run(
      "2000-01-01T00:00:00.000Z",
      expiredSetup.claimId,
    );
    expect(store.getPersonDetail(manager.context, person.id).access.state).toBe("setup_expired");

    const ready = store.issueEnrollmentClaim(manager.context, {
      mutationId: randomUUID(),
      membershipId: person.id,
      preset: "proposal_personalizer",
    });
    const claimed = await store.claim({
      claimToken: ready.token!,
      loginName: `sam.${Date.now().toString(36)}`,
      passphrase: PASSPHRASE,
      displayName: "Sam",
    });
    expect(store.getPersonDetail(manager.context, person.id).access.state).toBe("access_set_up");
    expect(claimed.context.grants.slice().sort()).toEqual(
      [...GRANT_PRESETS.proposal_personalizer].sort(),
    );
  });

  it("supports group lifecycle, version conflict, and household isolation", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    const kid = store.createPerson(manager.context, {
      mutationId: randomUUID(),
      displayName: "Kid",
      classification: "child",
    });
    const createId = randomUUID();
    const kids = store.createGroup(manager.context, {
      mutationId: createId,
      name: "Kids",
      membershipIds: [kid.id],
    });
    expect(
      store.createGroup(manager.context, {
        mutationId: createId,
        name: "Kids",
        membershipIds: [kid.id],
      }).id,
    ).toBe(kids.id);

    expect(() =>
      store.createGroup(manager.context, {
        mutationId: randomUUID(),
        name: "kids",
        membershipIds: [],
      }),
    ).toThrow(/already exists/i);

    const renamed = store.updateGroup(manager.context, kids.id, {
      name: "Reed kids",
      membershipIds: [kid.id, IDS.avery],
      expectedVersion: kids.version,
    });
    expect(renamed.name).toBe("Reed kids");
    expect(() =>
      store.updateGroup(manager.context, kids.id, {
        name: "Reed kids",
        membershipIds: [kid.id],
        expectedVersion: kids.version,
      }),
    ).toThrow(/re-read/i);

    expect(() =>
      store.updateGroup(manager.context, kids.id, {
        name: "Reed kids",
        membershipIds: [randomUUID()],
        expectedVersion: renamed.version,
      }),
    ).toThrow(/not found/i);

    store.deleteGroup(manager.context, kids.id);
    expect(store.listGroups(manager.context.householdId)).toEqual([]);
    expect(
      store.listMemberships(manager.context.householdId).some((m) => m.id === kid.id),
    ).toBe(true);

    const foreignHousehold = randomUUID();
    const foreignMembership = randomUUID();
    db.prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)").run(
      foreignHousehold,
      "Other",
      "UTC",
    );
    db.prepare(
      `INSERT INTO members (id, household_id, display_name, capabilities_json)
       VALUES (?, ?, 'Foreign', '[]')`,
    ).run(foreignMembership, foreignHousehold);
    db.prepare(
      `INSERT INTO household_memberships
       (id, household_id, user_id, display_name, status, created_at, classification, version)
       VALUES (?, ?, NULL, 'Foreign', 'pending', ?, NULL, 1)`,
    ).run(foreignMembership, foreignHousehold, new Date().toISOString());

    expect(() =>
      store.createGroup(manager.context, {
        mutationId: randomUUID(),
        name: "Mixed",
        membershipIds: [foreignMembership],
      }),
    ).toThrow(/not found/i);
  });

  it("enforces structure vs enroll authority and CSRF over HTTP", async () => {
    const harness = await createHttpHarness();
    temps.push(harness.dbPath);
    try {
      const manager = await httpClaimManager(harness, `mgr.${Date.now().toString(36)}`);
      const headers = authHeaders(harness, manager);

      const create = await harness.app.inject({
        method: "POST",
        url: "/api/v1/people",
        headers,
        payload: {
          mutationId: randomUUID(),
          displayName: "Pat",
          classification: "adult",
        },
      });
      expect(create.statusCode).toBe(200);
      const personId = (create.json() as { person: { id: string } }).person.id;

      const missingCsrf = await harness.app.inject({
        method: "POST",
        url: "/api/v1/people",
        headers: { cookie: headers.cookie, origin: harness.origin },
        payload: {
          mutationId: randomUUID(),
          displayName: "No CSRF",
          classification: "child",
        },
      });
      expect(missingCsrf.statusCode).toBe(403);

      const enrollChild = await harness.app.inject({
        method: "POST",
        url: "/api/v1/enrollment/claims",
        headers,
        payload: {
          mutationId: randomUUID(),
          membershipId: IDS.avery,
          preset: "direct_personalizer",
        },
      });
      const token = (enrollChild.json() as { claim: { token: string } }).claim.token;
      const childClaim = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/claim",
        headers: { origin: harness.origin },
        payload: {
          claimToken: token,
          loginName: `avery.${Date.now().toString(36)}`,
          passphrase: PASSPHRASE,
          displayName: "Avery Reed",
        },
      });
      const child = sessionFromResponse(harness, childClaim);
      const childHeaders = authHeaders(harness, child);

      expect(
        (
          await harness.app.inject({
            method: "POST",
            url: "/api/v1/people",
            headers: childHeaders,
            payload: {
              mutationId: randomUUID(),
              displayName: "Nope",
              classification: "child",
            },
          })
        ).statusCode,
      ).toBe(403);

      expect(
        (
          await harness.app.inject({
            method: "GET",
            url: `/api/v1/people/${personId}`,
            headers: childHeaders,
          })
        ).statusCode,
      ).toBe(200);

      expect(
        (
          await harness.app.inject({
            method: "DELETE",
            url: `/api/v1/people/${personId}/setup`,
            headers: childHeaders,
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await harness.close();
    }
  });
});

describe("P0-004A r3 fixture-free bootstrap and cleanup", () => {
  it("defaults AUTO_SEED off and bootstrap creates only the claimed manager", async () => {
    const { loadConfig } = await import("../../src/server/config.js");
    expect(loadConfig({ APP_PROFILE: "development" }).autoSeed).toBe(false);
    expect(loadConfig({ APP_PROFILE: "development", AUTO_SEED: "1" }).autoSeed).toBe(true);

    const dbPath = path.join(os.tmpdir(), `hd-004a-boot-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    migrate(db);
    const store = new AppStore(db);

    expect(db.prepare("SELECT COUNT(*) AS c FROM household_memberships").get()).toEqual({ c: 0 });
    const issued = store.issueBootstrapClaim("America/New_York");
    expect(db.prepare("SELECT COUNT(*) AS c FROM household_memberships").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) AS c FROM households").get()).toEqual({ c: 1 });

    await store.claim({
      claimToken: issued.token,
      loginName: `boot.${Date.now().toString(36)}`,
      passphrase: PASSPHRASE,
      displayName: "Parent One",
    });

    const members = db
      .prepare("SELECT display_name FROM household_memberships ORDER BY display_name")
      .all() as Array<{ display_name: string }>;
    expect(members).toEqual([{ display_name: "Parent One" }]);
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM household_memberships WHERE display_name LIKE '%Reed%'").get(),
    ).toEqual({ c: 0 });
  });
});

async function enrollAndClaimChild(
  store: AppStore,
  manager: AuthContext,
  membershipId: string,
) {
  const claim = store.issueEnrollmentClaim(manager, {
    mutationId: randomUUID(),
    membershipId,
    preset: "direct_personalizer",
  });
  await store.claim({
    claimToken: claim.token!,
    loginName: `child.${Date.now().toString(36)}`,
    passphrase: PASSPHRASE,
    displayName: "Avery Reed",
  });
}
