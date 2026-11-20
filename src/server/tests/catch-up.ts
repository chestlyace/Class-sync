import { and, eq, exists, inArray } from "drizzle-orm";
import type { Db } from "@/server/db";
import {
  courseTest,
  testAnswer,
  testAttempt,
  testCatchUpStudent,
} from "@/server/db/schema";
import type { TestRow } from "./queries";

export type CatchUpTest = Pick<
  TestRow,
  "id" | "courseId" | "catchUpOfId" | "catchUpFor" | "startedAt"
>;

/** The catch-up fields of a test, narrowed: null for an ordinary test. */
function asCatchUp(test: CatchUpTest) {
  if (test.catchUpOfId === null || test.catchUpFor === null) return null;
  return { originalId: test.catchUpOfId, mode: test.catchUpFor };
}

/**
 * Of `studentIds` (the caller's roster), who may sit each of `tests`, as testId → student ids.
 * An ordinary test admits everyone. A catch-up admits, in `picked` mode, the listed students;
 * in `missed` mode, students with no attempt on the original and none on another catch-up of
 * it. Once the catch-up has started, a student with an attempt on it stays eligible. At most
 * three queries however many tests and students.
 */
export async function eligibleStudentsForTests(
  db: Db,
  tests: CatchUpTest[],
  studentIds: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  const catchUps: {
    test: CatchUpTest;
    originalId: string;
    mode: "missed" | "picked";
  }[] = [];
  for (const test of tests) {
    const c = asCatchUp(test);
    if (!c) result.set(test.id, new Set(studentIds));
    else {
      result.set(test.id, new Set());
      catchUps.push({ test, ...c });
    }
  }
  if (catchUps.length === 0 || studentIds.length === 0) return result;

  const pickedIds = catchUps
    .filter((c) => c.mode === "picked")
    .map((c) => c.test.id);
  const missedOriginals = [
    ...new Set(
      catchUps.filter((c) => c.mode === "missed").map((c) => c.originalId),
    ),
  ];

  // Query 1: the picked lists. Query 2: every catch-up of the originals that "missed" looks at.
  const [picked, siblings] = await Promise.all([
    pickedIds.length === 0
      ? []
      : db
          .select({
            testId: testCatchUpStudent.testId,
            studentId: testCatchUpStudent.studentId,
          })
          .from(testCatchUpStudent)
          .where(
            and(
              inArray(testCatchUpStudent.testId, pickedIds),
              inArray(testCatchUpStudent.studentId, studentIds),
            ),
          ),
    missedOriginals.length === 0
      ? []
      : db
          .select({ id: courseTest.id, originalId: courseTest.catchUpOfId })
          .from(courseTest)
          .where(inArray(courseTest.catchUpOfId, missedOriginals)),
  ]);
  const pickedBy = new Map<string, Set<string>>();
  for (const row of picked) {
    const set = pickedBy.get(row.testId) ?? new Set<string>();
    set.add(row.studentId);
    pickedBy.set(row.testId, set);
  }
  const catchUpsOf = new Map<string, string[]>();
  for (const row of siblings) {
    if (row.originalId === null) continue;
    catchUpsOf.set(row.originalId, [
      ...(catchUpsOf.get(row.originalId) ?? []),
      row.id,
    ]);
  }

  // Query 3: who has an attempt on any test that matters.
  const wanted = new Set<string>();
  for (const c of catchUps) {
    if (c.test.startedAt !== null) wanted.add(c.test.id);
    if (c.mode !== "missed") continue;
    wanted.add(c.originalId);
    for (const id of catchUpsOf.get(c.originalId) ?? []) wanted.add(id);
  }
  const attemptedBy = new Map<string, Set<string>>();
  if (wanted.size > 0) {
    const attempts = await db
      .select({ testId: testAttempt.testId, studentId: testAttempt.studentId })
      .from(testAttempt)
      .where(
        and(
          inArray(testAttempt.testId, [...wanted]),
          inArray(testAttempt.studentId, studentIds),
        ),
      );
    for (const row of attempts) {
      const set = attemptedBy.get(row.testId) ?? new Set<string>();
      set.add(row.studentId);
      attemptedBy.set(row.testId, set);
    }
  }

  for (const c of catchUps) {
    const eligible = result.get(c.test.id)!;
    const started = c.test.startedAt !== null;
    const blockers =
      c.mode === "missed"
        ? [
            c.originalId,
            ...(catchUpsOf.get(c.originalId) ?? []).filter(
              (id) => id !== c.test.id,
            ),
          ]
        : [];
    for (const studentId of studentIds) {
      const rule =
        c.mode === "picked"
          ? (pickedBy.get(c.test.id)?.has(studentId) ?? false)
          : !blockers.some((id) => attemptedBy.get(id)?.has(studentId));
      const held =
        started && (attemptedBy.get(c.test.id)?.has(studentId) ?? false);
      if (rule || held) eligible.add(studentId);
    }
  }
  return result;
}

/** Of `studentIds`, those who may sit `test`. An ordinary test admits everyone. */
export async function eligibleStudents(
  db: Db,
  test: CatchUpTest,
  studentIds: string[],
): Promise<Set<string>> {
  const byTest = await eligibleStudentsForTests(db, [test], studentIds);
  return byTest.get(test.id) ?? new Set();
}

/**
 * `roster` narrowed to the students who may sit `test`: a catch-up's live and results views
 * list only these. An ordinary test returns `roster` as it is, with no query.
 */
export async function onlyEligible<T extends { studentId: string }>(
  db: Db,
  test: CatchUpTest,
  roster: T[],
): Promise<T[]> {
  if (test.catchUpOfId === null) return roster
  const eligible = await eligibleStudents(
    db,
    test,
    roster.map((r) => r.studentId),
  )
  return roster.filter((r) => eligible.has(r.studentId))
}

/** Whether one student may sit `test`. Being on the course roster stays the caller's check. */
export async function mayTakeCatchUp(
  db: Db,
  test: CatchUpTest,
  studentId: string,
): Promise<boolean> {
  return (await eligibleStudents(db, test, [studentId])).has(studentId);
}

/**
 * testId → studentId → the attempt that sat it: one with at least one saved answer. Opening
 * the link and answering nothing does not count. One query.
 */
export async function satAttempts(
  db: Db,
  testIds: string[],
): Promise<Map<string, Map<string, { attemptId: string; joinedAt: Date }>>> {
  const result = new Map<
    string,
    Map<string, { attemptId: string; joinedAt: Date }>
  >();
  if (testIds.length === 0) return result;
  const rows = await db
    .select({
      attemptId: testAttempt.id,
      testId: testAttempt.testId,
      studentId: testAttempt.studentId,
      joinedAt: testAttempt.joinedAt,
    })
    .from(testAttempt)
    .where(
      and(
        inArray(testAttempt.testId, testIds),
        exists(
          db
            .select({ one: testAnswer.attemptId })
            .from(testAnswer)
            .where(eq(testAnswer.attemptId, testAttempt.id)),
        ),
      ),
    );
  for (const row of rows) {
    const byStudent = result.get(row.testId) ?? new Map();
    byStudent.set(row.studentId, {
      attemptId: row.attemptId,
      joinedAt: row.joinedAt,
    });
    result.set(row.testId, byStudent);
  }
  return result;
}
