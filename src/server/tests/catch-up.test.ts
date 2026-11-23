import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "@/server/core/context";
import type { Db } from "@/server/db";
import {
  courseTest,
  testAttempt,
  testCatchUpStudent,
} from "@/server/db/schema";
import { createTestDb } from "@/test/db";
import {
  at,
  clearMarkingData,
  insertStartedTest,
  joinTest,
  putAnswer,
  setupCourse,
} from "@/test/marking-fixture";
import {
  eligibleStudents,
  eligibleStudentsForTests,
  mayTakeCatchUp,
  satAttempts,
} from "./catch-up";

describe("who may sit a catch-up", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await clearMarkingData(db);
  });

  /** A catch-up of `originalId`, unstarted unless `startedAt` is given. */
  async function insertCatchUp(
    lecturer: Ctx,
    courseId: string,
    originalId: string,
    catchUpFor: "missed" | "picked",
    opts: { startedAt?: Date | null; picked?: Ctx[] } = {},
  ) {
    const startedAt = opts.startedAt ?? null;
    const [row] = await db
      .insert(courseTest)
      .values({
        courseId,
        code: crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase(),
        title: "CA 1 (catch-up)",
        durationMinutes: 30,
        defaultMark: 2,
        startedAt,
        deadlineAt: startedAt
          ? new Date(startedAt.getTime() + 30 * 60_000)
          : null,
        createdBy: lecturer.user.id,
        catchUpOfId: originalId,
        catchUpFor,
      })
      .returning();
    for (const s of opts.picked ?? []) {
      await db
        .insert(testCatchUpStudent)
        .values({
          testId: row.id,
          studentId: s.user.id,
          addedBy: lecturer.user.id,
        });
    }
    return row;
  }

  /** The original: Alice and Bob joined it; Carol and Dave did not. */
  async function original() {
    const c = await setupCourse(db);
    const t = await insertStartedTest(db, c.lecturer, c.bio.id);
    const aliceAttempt = await joinTest(db, t.test.id, c.alice);
    await joinTest(db, t.test.id, c.bob);
    await putAnswer(db, aliceAttempt.id, t.q1.id, { optionId: t.o1.id });
    const ids = [c.alice, c.bob, c.carol, c.dave].map((s) => s.user.id);
    return { ...c, ...t, ids };
  }

  it("a non-catch-up admits everyone", async () => {
    const o = await original();
    expect(await eligibleStudents(db, o.test, o.ids)).toEqual(new Set(o.ids));
    expect(await mayTakeCatchUp(db, o.test, o.dave.user.id)).toBe(true);
  });

  it("missed admits only students with no attempt on the original", async () => {
    const o = await original();
    const cu = await insertCatchUp(o.lecturer, o.bio.id, o.test.id, "missed");
    expect(await eligibleStudents(db, cu, o.ids)).toEqual(
      new Set([o.carol.user.id, o.dave.user.id]),
    );
    expect(await mayTakeCatchUp(db, cu, o.carol.user.id)).toBe(true);
    expect(await mayTakeCatchUp(db, cu, o.alice.user.id)).toBe(false);
  });

  it("missed refuses a student who sat another catch-up of the same original", async () => {
    const o = await original();
    const first = await insertCatchUp(
      o.lecturer,
      o.bio.id,
      o.test.id,
      "missed",
      { startedAt: at(60) },
    );
    const second = await insertCatchUp(
      o.lecturer,
      o.bio.id,
      o.test.id,
      "missed",
    );
    await joinTest(db, first.id, o.carol, at(61));
    expect(await eligibleStudents(db, second, o.ids)).toEqual(
      new Set([o.dave.user.id]),
    );
    // Carol keeps her hold on the catch-up she joined, which has started.
    expect(await eligibleStudents(db, first, o.ids)).toEqual(
      new Set([o.carol.user.id, o.dave.user.id]),
    );
  });

  it("picked admits only listed students, including one who handed in the original", async () => {
    const o = await original();
    const cu = await insertCatchUp(o.lecturer, o.bio.id, o.test.id, "picked", {
      picked: [o.alice, o.dave],
    });
    expect(await eligibleStudents(db, cu, o.ids)).toEqual(
      new Set([o.alice.user.id, o.dave.user.id]),
    );
  });

  it("before Start an attempt gives no hold", async () => {
    const o = await original();
    const cu = await insertCatchUp(o.lecturer, o.bio.id, o.test.id, "picked", {
      picked: [o.carol, o.dave],
    });
    await joinTest(db, cu.id, o.carol, at(50));
    await db
      .delete(testCatchUpStudent)
      .where(eq(testCatchUpStudent.studentId, o.carol.user.id));
    expect(cu.startedAt).toBeNull();
    expect(await eligibleStudents(db, cu, o.ids)).toEqual(
      new Set([o.dave.user.id]),
    );
  });

  it("after Start an attempt keeps a student eligible", async () => {
    const o = await original();
    const cu = await insertCatchUp(o.lecturer, o.bio.id, o.test.id, "picked", {
      startedAt: at(60),
      picked: [o.carol, o.dave],
    });
    await joinTest(db, cu.id, o.carol, at(61));
    await db
      .delete(testCatchUpStudent)
      .where(eq(testCatchUpStudent.studentId, o.carol.user.id));
    expect(await eligibleStudents(db, cu, o.ids)).toEqual(
      new Set([o.carol.user.id, o.dave.user.id]),
    );
    expect(await mayTakeCatchUp(db, cu, o.carol.user.id)).toBe(true);
  });

  it("satAttempts ignores attempts with no answers", async () => {
    const o = await original();
    const sat = await satAttempts(db, [o.test.id]);
    // Alice answered; Bob only opened the test.
    expect([...(sat.get(o.test.id) ?? new Map()).keys()]).toEqual([
      o.alice.user.id,
    ]);
    const [aliceAttempt] = await db
      .select()
      .from(testAttempt)
      .where(eq(testAttempt.studentId, o.alice.user.id));
    expect(sat.get(o.test.id)?.get(o.alice.user.id)).toEqual({
      attemptId: aliceAttempt.id,
      joinedAt: aliceAttempt.joinedAt,
    });
    expect((await satAttempts(db, [])).size).toBe(0);
  });

  it("the batched form agrees with the single form for two catch-ups", async () => {
    const o = await original();
    const missed = await insertCatchUp(
      o.lecturer,
      o.bio.id,
      o.test.id,
      "missed",
    );
    const picked = await insertCatchUp(
      o.lecturer,
      o.bio.id,
      o.test.id,
      "picked",
      { picked: [o.alice, o.carol] },
    );
    const batched = await eligibleStudentsForTests(
      db,
      [o.test, missed, picked],
      o.ids,
    );
    expect(batched.get(o.test.id)).toEqual(
      await eligibleStudents(db, o.test, o.ids),
    );
    expect(batched.get(missed.id)).toEqual(
      await eligibleStudents(db, missed, o.ids),
    );
    expect(batched.get(picked.id)).toEqual(
      await eligibleStudents(db, picked, o.ids),
    );
    expect(batched.get(picked.id)).toEqual(
      new Set([o.alice.user.id, o.carol.user.id]),
    );
  });
});
