import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addHouseholdDays } from "../../src/domain/time.js";
import { loadConfig } from "../../src/server/config.js";
import { migrate, openDatabase, resolveDbPath } from "../../src/server/db.js";
import { AppStore } from "../../src/server/store.js";
import { assertArgon2idPhc } from "../../src/server/crypto.js";
import { SEED } from "../../src/server/seeds/evaluation.js";
import { GRANT_PRESETS } from "../../src/shared/grants.js";

const temps: string[] = [];
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");

afterEach(() => {
  for (const p of temps.splice(0)) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
});

function freshStore(timezone = "America/New_York") {
  const dbPath = path.join(os.tmpdir(), `hd-p2-${Date.now()}-${Math.random()}.sqlite`);
  temps.push(dbPath);
  const db = openDatabase(dbPath);
  migrate(db);
  const store = new AppStore(db);
  store.seed(timezone);
  return { db, store, dbPath };
}

async function claimManager(store: AppStore) {
  const bootstrap = store.issueBootstrapClaim();
  return store.claim({
    claimToken: bootstrap.token,
    loginName: `mgr${Date.now().toString(36)}`,
    passphrase: "unique-passphrase-ok!",
    displayName: "Morgan Reed",
  });
}

describe("P0-002 authenticated authority", () => {
  it("migrates a populated P0-001 fixture without rewriting occurrence structure", () => {
    const dbPath = path.join(os.tmpdir(), `hd-mig-${Date.now()}.sqlite`);
    temps.push(dbPath);
    const db = openDatabase(dbPath);
    const sql001 = fs.readFileSync(
      path.resolve(process.cwd(), "db/migrations/001_initial.sql"),
      "utf8",
    );
    db.exec(sql001);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
      "001_initial.sql",
      new Date().toISOString(),
    );

    const hz = "America/New_York";
    db.prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)").run(
      SEED.household.id,
      SEED.household.name,
      hz,
    );
    for (const m of SEED.members) {
      db.prepare(
        "INSERT INTO members (id, household_id, display_name, capabilities_json) VALUES (?, ?, ?, ?)",
      ).run(m.id, SEED.household.id, m.displayName, JSON.stringify([...m.capabilities]));
    }
    const defId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const revId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    db.prepare("INSERT INTO routine_definitions (id, household_id, kind) VALUES (?, ?, 'morning')").run(
      defId,
      SEED.household.id,
    );
    db.prepare(
      `INSERT INTO routine_revisions (id, definition_id, effective_date, title, weekdays_json, created_at)
       VALUES (?, ?, '2026-09-01', 'Morning Routine', ?, ?)`,
    ).run(revId, defId, JSON.stringify([1, 2, 3, 4, 5, 6, 7]), new Date().toISOString());
    const stepIds = [
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    ];
    db.prepare(
      "INSERT INTO revision_steps (id, revision_id, position, text, obligation) VALUES (?, ?, 0, 'Make bed', 'required')",
    ).run(stepIds[0], revId);
    db.prepare(
      "INSERT INTO revision_steps (id, revision_id, position, text, obligation) VALUES (?, ?, 1, 'Stretch', 'optional')",
    ).run(stepIds[1], revId);
    db.prepare("INSERT INTO revision_assignees (revision_id, member_id) VALUES (?, ?)").run(
      revId,
      SEED.members[1].id,
    );
    const occId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    db.prepare(
      `INSERT INTO occurrences
       (id, household_id, definition_id, revision_id, household_date, accountable_member_id, title, schedule_anchor, version)
       VALUES (?, ?, ?, ?, '2026-09-06', ?, 'Morning Routine', 'morning', 1)`,
    ).run(occId, SEED.household.id, defId, revId, SEED.members[1].id);
    const occStep1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    const occStep2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
    db.prepare(
      `INSERT INTO occurrence_steps (id, occurrence_id, position, text, obligation, status)
       VALUES (?, ?, 0, 'Make bed', 'required', 'completed')`,
    ).run(occStep1, occId);
    db.prepare(
      `INSERT INTO occurrence_steps (id, occurrence_id, position, text, obligation, status)
       VALUES (?, ?, 1, 'Stretch', 'optional', 'open')`,
    ).run(occStep2, occId);
    db.prepare(
      `INSERT INTO step_reports
       (id, mutation_id, occurrence_id, occurrence_step_id, accountable_member_id, acting_member_id, performed_at, recorded_at, resulting_state)
       VALUES (?, ?, ?, ?, ?, ?, '2026-09-06T12:00:00.000Z', '2026-09-06T12:00:01.000Z', 'completed')`,
    ).run(
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      "ffffffff-ffff-4fff-8fff-fffffffffff1",
      occId,
      occStep1,
      SEED.members[1].id,
      SEED.members[1].id,
    );
    db.prepare("INSERT INTO sessions (id, household_id, member_id, created_at) VALUES (?, ?, ?, ?)").run(
      "old-session",
      SEED.household.id,
      SEED.members[0].id,
      new Date().toISOString(),
    );

    const before = {
      steps: db
        .prepare(
          "SELECT position, text, obligation, status FROM occurrence_steps WHERE occurrence_id = ? ORDER BY position",
        )
        .all(occId),
      report: db
        .prepare(
          "SELECT accountable_member_id, acting_member_id, performed_at, recorded_at, resulting_state, mutation_id FROM step_reports WHERE occurrence_id = ?",
        )
        .get(occId),
    };

    migrate(db);

    const after = {
      steps: db
        .prepare(
          "SELECT position, text, obligation, status FROM occurrence_steps WHERE occurrence_id = ? ORDER BY position",
        )
        .all(occId),
      report: db
        .prepare(
          "SELECT accountable_member_id, acting_member_id, performed_at, recorded_at, resulting_state, mutation_id FROM step_reports WHERE occurrence_id = ?",
        )
        .get(occId),
    };
    expect(after).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) as c FROM sessions").get()).toEqual({ c: 0 });
    expect(
      (
        db
          .prepare("SELECT status FROM household_memberships WHERE id = ?")
          .get(SEED.members[1].id) as { status: string }
      ).status,
    ).toBe("pending");
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM revision_steps WHERE logical_item_id IS NULL")
          .get() as { c: number }
      ).c,
    ).toBe(0);
    void resolveDbPath;
    void repoRoot;
  });

  it("hashes passphrases with Argon2id and throttles repeated failures", async () => {
    const { store, db } = freshStore();
    await claimManager(store);
    expect(store.validatePassphrasePolicy("short").ok).toBe(false);
    expect(store.validatePassphrasePolicy("iloveyouiloveyou").ok).toBe(false);

    const phc = (
      db.prepare("SELECT passphrase_phc FROM user_credentials LIMIT 1").get() as {
        passphrase_phc: string;
      }
    ).passphrase_phc;
    assertArgon2idPhc(phc);

    const loginName = (
      db.prepare("SELECT login_name FROM users LIMIT 1").get() as { login_name: string }
    ).login_name;
    for (let i = 0; i < 5; i++) {
      const fail = await store.login(loginName, "wrong-passphrase!!!!");
      expect("error" in fail).toBe(true);
    }
    const throttled = await store.login(loginName, "wrong-passphrase!!!!");
    expect("error" in throttled && throttled.error === "throttled").toBe(true);
  });

  it("personalization, proposals, and private tasks respect authority", async () => {
    const { store } = freshStore();
    const managerAuth = await claimManager(store);
    const childId = "22222222-2222-4222-8222-222222222202";
    const propId = "22222222-2222-4222-8222-222222222204";

    const childClaim = store.issueEnrollmentClaim(managerAuth.context, {
      membershipId: childId,
      preset: "direct_personalizer",
    });
    const childAuth = await store.claim({
      claimToken: childClaim.token,
      loginName: "avery.reed",
      passphrase: "unique-passphrase-ok!",
      displayName: "Avery Reed",
    });

    const today = store.householdDateNow(managerAuth.context);
    store.createRoutine(managerAuth.context, {
      title: "Morning Routine",
      assigneeMemberIds: [childId, propId],
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      steps: [
        { text: "Make bed", obligation: "required" },
        { text: "Pack lunch", obligation: "as_needed" },
        { text: "Stretch", obligation: "optional" },
      ],
    });

    const beforeOcc = store.materializeForDate(childAuth.context, today)[0];
    store.setStepStatus(childAuth.context, beforeOcc.id, beforeOcc.steps[0].id, {
      mutationId: "33333333-3333-4333-8333-333333333301",
      status: "completed",
      performedAt: "2026-09-07T12:00:00.000Z",
    });
    const snap = store.occurrenceSnapshotStructure(beforeOcc.id);

    store.savePersonalLayer(childAuth.context, {
      additions: [
        {
          text: "Clean up breakfast",
          obligation: "optional",
          anchorLogicalItemId: beforeOcc.steps[0].logicalItemId,
          place: "after",
        },
      ],
    });
    expect(store.occurrenceSnapshotStructure(beforeOcc.id)).toEqual(snap);

    const tomorrow = addHouseholdDays(today, 1);
    const preview = store.previewComposition(childAuth.context, childId, tomorrow);
    expect(preview.steps.some((p) => p.text === "Clean up breakfast")).toBe(true);

    const propClaim = store.issueEnrollmentClaim(managerAuth.context, {
      membershipId: propId,
      preset: "proposal_personalizer",
    });
    const propAuth = await store.claim({
      claimToken: propClaim.token,
      loginName: "casey.reed",
      passphrase: "unique-passphrase-ok!",
      displayName: "Casey Reed",
    });
    const proposal = store.createProposal(propAuth.context, {
      text: "Pack soccer bag",
      obligation: "as_needed",
      place: "end",
    });
    store.decideProposal(managerAuth.context, proposal.id, { decision: "approved" });
    store.decideProposal(managerAuth.context, proposal.id, { decision: "approved" });
    expect(() =>
      store.decideProposal(managerAuth.context, proposal.id, { decision: "rejected" }),
    ).toThrow();

    const task = store.createTask(childAuth.context, {
      title: "Private diary",
      visibility: "private",
    });
    expect(store.listTasks(managerAuth.context).some((t) => t.id === task.id)).toBe(false);
    expect(store.listTasks(childAuth.context).some((t) => t.id === task.id)).toBe(true);
  });

  it("rejects incomplete hosted configuration and forbids auto-seed bypass", () => {
    expect(() =>
      loadConfig({
        APP_PROFILE: "hosted",
        PUBLIC_ORIGIN: "http://insecure.example",
        DB_PATH: "runtime/hosted.sqlite",
        BACKUP_DIR: "runtime/backups",
      }),
    ).toThrow(/https/i);
    expect(() =>
      loadConfig({
        APP_PROFILE: "hosted",
        PUBLIC_ORIGIN: "https://family.example.invalid",
        DB_PATH: "runtime/hosted.sqlite",
        BACKUP_DIR: "runtime/backups",
        AUTO_SEED: "1",
      }),
    ).toThrow(/AUTO_SEED/i);
    const ok = loadConfig({
      APP_PROFILE: "hosted",
      PUBLIC_ORIGIN: "https://family.example.invalid",
      DB_PATH: "runtime/hosted.sqlite",
      BACKUP_DIR: "runtime/backups",
    });
    expect(ok.cookieName).toBe("__Host-hd_session");
    expect(ok.cookieSecure).toBe(true);
    expect(ok.autoSeed).toBe(false);
  });

  it("bootstraps six memberships across grant presets", async () => {
    const { store } = freshStore();
    const manager = await claimManager(store);
    const pending = store
      .listMemberships(manager.context.householdId)
      .filter((m) => m.status === "pending");
    expect(pending.length).toBe(5);

    const presets = [
      "manager",
      "direct_personalizer",
      "direct_personalizer",
      "proposal_personalizer",
      "proposal_personalizer",
    ] as const;
    for (const [index, membership] of pending.entries()) {
      const preset = presets[index]!;
      const claim = store.issueEnrollmentClaim(manager.context, {
        membershipId: membership.id,
        preset,
      });
      const auth = await store.claim({
        claimToken: claim.token,
        loginName: `member${index}.${Date.now().toString(36)}`,
        passphrase: "unique-passphrase-ok!",
        displayName: membership.displayName,
      });
      for (const grant of GRANT_PRESETS[preset]) {
        expect(auth.context.grants).toContain(grant);
      }
    }
    const active = store
      .listMemberships(manager.context.householdId)
      .filter((m) => m.status === "active");
    expect(active.length).toBe(6);
  });

  it("keeps another household's routine and tasks invisible", async () => {
    const { store, db } = freshStore();
    const manager = await claimManager(store);
    const foreignHousehold = "99999999-9999-4999-8999-999999999999";
    const foreignMembership = "99999999-9999-4999-8999-999999999991";
    const foreignRoutine = "99999999-9999-4999-8999-999999999992";
    db.prepare("INSERT INTO households (id, name, timezone) VALUES (?, ?, ?)").run(
      foreignHousehold,
      "Other Household",
      "UTC",
    );
    db.prepare(
      `INSERT INTO household_memberships
         (id, household_id, user_id, display_name, status, created_at)
       VALUES (?, ?, NULL, 'Foreign', 'pending', ?)`,
    ).run(foreignMembership, foreignHousehold, new Date().toISOString());
    db.prepare(
      "INSERT INTO routine_definitions (id, household_id, kind) VALUES (?, ?, 'morning')",
    ).run(foreignRoutine, foreignHousehold);

    expect(store.getRoutine(manager.context.householdId)?.id).not.toBe(foreignRoutine);
    expect(() =>
      store.createRevision(manager.context, foreignRoutine, {
        title: "Hijack",
        weekdays: [1],
        assigneeMemberIds: [manager.context.membershipId],
        steps: [{ text: "Nope", obligation: "required" }],
      }),
    ).toThrow();
    expect(
      store.listMemberships(manager.context.householdId).some((m) => m.id === foreignMembership),
    ).toBe(false);
  });
});
