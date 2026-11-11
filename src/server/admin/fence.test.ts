import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The data fence: admins see counts across the platform and account facts about people, never
// students' marks, submissions, answers, content, per-student attendance or credentials. This
// test reads the admin code (the server read models and the admin pages and actions) as text, so
// a new query cannot cross the fence without failing here.

const ADMIN_DIR = path.resolve(process.cwd(), 'src/server/admin')
const ADMIN_APP_DIR = path.resolve(process.cwd(), 'src/app/(app)/admin')
const SRC_DIR = path.resolve(process.cwd(), 'src')

/** (a) Feature modules that read marks, submissions, answers or content: admin code imports none of them. */
const FORBIDDEN_MODULES = [
  '@/server/assignments',
  '@/server/tests',
  '@/server/performance',
  '@/server/attendance',
  '@/server/revision',
  '@/server/notes',
  '@/server/files',
]

/** (b) The only schema exports admin code may import. `class` is exported as `class_`. */
const ADMIN_ALLOWED_TABLES = new Set([
  'user',
  'session',
  'apikey',
  'oauthAccessToken',
  'oauthRefreshToken',
  'oauthConsent',
  'oauthClient',
  'school',
  'class_',
  'classLecturer',
  'classStudent',
  'course',
  'attendanceWindow',
  'attendanceCheckIn',
  'assignment',
  'submission',
  'courseTest',
  'testAttempt',
  'testAnswer',
  'resource',
  'revisionOutcome',
  'file',
  'adminAction',
  'opsEvent',
  'ADMIN_ACTIONS',
  'OPS_EVENT_KINDS',
])

/** (c) Columns admin code never touches, as `.member` accesses on any table. */
const FORBIDDEN_MEMBERS = [
  'suggestedMark',
  'suggestedReason',
  'suggestedFeedback',
  'mark',
  'grade',
  'score',
  'feedback',
  'comment',
  'text',
  'bodyText',
  'content',
  'body',
  'answer',
  'storageKey',
  'key',
  'token',
  'password',
  'privateKey',
  'clientSecret',
  'secret',
  // Content and per-student columns on allowed tables.
  'instructions',
  'prompt',
  'correct',
  'isCorrect',
  'isLate',
  'studentId',
  'optionId',
  'latitude',
  'longitude',
  'accuracyM',
]
const FORBIDDEN_MEMBER_RE = new RegExp(`\\.(${FORBIDDEN_MEMBERS.join('|')})\\b`, 'g')
/** The same columns by their SQL names, for raw `sql` fragments. */
const FORBIDDEN_SQL_COLUMN_RE =
  /\b(suggested_mark|suggested_reason|suggested_feedback|storage_key|body_text|private_key|client_secret|is_late|is_correct|student_id|option_id|accuracy_m)\b/g

/** The literal key of a translation call, `t('a.b')` or `t.rich("a.b", …)`. */
const TRANSLATION_KEY_RE = /(\bt(?:\.\w+)?\(\s*)(['"])[\w.]*\2/g

/** Identifiers of tables (not the constant lists) that admin code may import. */
const TABLE_NAMES = [...ADMIN_ALLOWED_TABLES].filter((n) => !/^[A-Z_]+$/.test(n)).join('|')
/** A table bound to a key, `{ s: submission }`: selects every column of it. */
const TABLE_AS_VALUE_RE = new RegExp(`[\\w'"\\]]\\s*:\\s*(${TABLE_NAMES})\\s*(?=[,}])`, 'g')
/** Shorthand `{ submission }` or `{ id, submission }`, checked inside select calls. */
const TABLE_SHORTHAND_RE = new RegExp(`[{,]\\s*(${TABLE_NAMES})\\s*(?=[,}])`, 'g')
/** `{ ...submission }` spreads a table's columns. */
const TABLE_SPREAD_RE = new RegExp(`\\.\\.\\.\\s*(${TABLE_NAMES})\\b`, 'g')

/** The argument text of every `.select(...)`, `.selectDistinct(...)` and `.selectDistinctOn(...)` call. */
function selectArguments(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/\.select(?:Distinct(?:On)?)?\s*\(/g)) {
    const start = m.index + m[0].length
    let depth = 1
    let i = start
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
    }
    out.push(src.slice(start, i - 1))
  }
  return out
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return walk(full)
    return e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : []
  })
}

/** Turns a relative import into its `@/` form so both spellings are checked alike. */
function normalizeSpecifier(spec: string, file: string): string {
  if (!spec.startsWith('.')) return spec
  return '@/' + path.relative(SRC_DIR, path.resolve(path.dirname(file), spec)).split(path.sep).join('/')
}

const isSchemaModule = (spec: string) => spec === '@/server/db/schema' || spec.startsWith('@/server/db/schema/')

/** Every rule the admin code must keep; returns one message per violation. */
function fenceViolations(file: string, src: string): string[] {
  const out: string[] = []
  const rel = path.relative(process.cwd(), file)

  // (a) and (b): every static import, export-from and dynamic import.
  const importRe = /\b(?:import|export)\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const m of src.matchAll(importRe)) {
    const clause = m[1]
    const spec = normalizeSpecifier(m[2] ?? m[3], file)
    if (FORBIDDEN_MODULES.some((f) => spec === f || spec.startsWith(f + '/'))) {
      out.push(`${rel}: imports ${spec}`)
    }
    if (!isSchemaModule(spec)) continue
    const named = clause === undefined ? null : /^(?:type\s+)?\{([^}]*)\}$/.exec(clause.trim())
    if (!named) {
      out.push(`${rel}: imports ${spec} other than by name`)
      continue
    }
    for (const part of named[1].split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim()
      if (name && !ADMIN_ALLOWED_TABLES.has(name)) out.push(`${rel}: imports ${name} from ${spec}`)
    }
  }

  // (c) Forbidden columns, by property name or SQL name. Translation keys in the pages
  // (`t('revoke.body')`) are message names, not columns: they are blanked first.
  const code = src.replace(TRANSLATION_KEY_RE, '$1$2$2')
  for (const m of code.matchAll(FORBIDDEN_MEMBER_RE)) out.push(`${rel}: reads .${m[1]}`)
  for (const m of src.matchAll(FORBIDDEN_SQL_COLUMN_RE)) out.push(`${rel}: names column ${m[1]}`)

  // (d) Whole-row reads: select() without columns, the relational query API, a whole table as a
  // select value (by key, shorthand or spread), table introspection, and aliases of anything but user.
  if (/\.select(?:Distinct(?:On)?)?\(\s*\)/.test(src)) out.push(`${rel}: select() without columns`)
  if (/\.query\.\w+\.find(?:First|Many)\b/.test(src)) out.push(`${rel}: relational query API`)
  for (const m of src.matchAll(TABLE_AS_VALUE_RE)) out.push(`${rel}: whole table ${m[1]} as a value`)
  for (const m of src.matchAll(TABLE_SPREAD_RE)) out.push(`${rel}: spreads table ${m[1]}`)
  for (const args of selectArguments(src)) {
    for (const m of args.matchAll(TABLE_SHORTHAND_RE)) out.push(`${rel}: selects whole table ${m[1]}`)
  }
  for (const m of src.matchAll(/\b(getTableColumns|getTableConfig)\b/g)) out.push(`${rel}: uses ${m[1]}`)
  for (const m of src.matchAll(/\balias\(\s*(\w+)/g)) {
    if (m[1] !== 'user') out.push(`${rel}: aliases ${m[1]}`)
  }

  return out
}

describe('admin data fence', () => {
  const files = [...walk(ADMIN_DIR), ...walk(ADMIN_APP_DIR)]

  it('finds the admin code, server and pages', () => {
    const rel = files.map((f) => path.relative(process.cwd(), f).split(path.sep).join('/'))
    expect(rel).toEqual(
      expect.arrayContaining([
        'src/server/admin/actions.ts',
        'src/server/admin/queries.ts',
        'src/app/(app)/admin/actions.ts',
        'src/app/(app)/admin/health/page.tsx',
        'src/app/(app)/admin/people/[id]/page.tsx',
      ]),
    )
    expect(rel.some((f) => f.endsWith('.test.ts'))).toBe(false)
  })

  it('admin code stays inside the fence', () => {
    const violations = files.flatMap((f) => fenceViolations(f, readFileSync(f, 'utf8')))
    expect(violations).toEqual([])
  })

  describe('catches', () => {
    const file = path.join(ADMIN_DIR, 'scratch.ts')
    const check = (src: string) => fenceViolations(file, src)

    it('(a) imports of feature modules, by alias or relative path', () => {
      expect(check(`import { x } from '@/server/assignments/service'`)).toHaveLength(1)
      expect(check(`import { x } from '../tests/marking'`)).toHaveLength(1)
      expect(check(`const m = await import('@/server/performance')`)).toHaveLength(1)
      expect(check(`export { x } from '@/server/notes/service'`)).toHaveLength(1)
      expect(check(`import { x } from '@/server/testsuite'`)).toEqual([])
    })

    it('(b) schema imports outside the allowed tables', () => {
      expect(check(`import { submissionFile } from '@/server/db/schema'`)).toHaveLength(1)
      expect(check(`import { user, testQuestion } from '@/server/db/schema'`)).toHaveLength(1)
      expect(check(`import { testOption as t } from '../db/schema'`)).toHaveLength(1)
      expect(check(`import type { AdminActionKind } from '@/server/db/schema'`)).toHaveLength(1)
      expect(check(`import * as schema from '@/server/db/schema'`)).toHaveLength(1)
      expect(check(`import { account } from '@/server/db/schema/auth'`)).toHaveLength(1)
      expect(check(`import {\n  user,\n  session,\n} from '@/server/db/schema'`)).toEqual([])
    })

    it('(c) forbidden columns', () => {
      for (const member of ['suggestedMark', 'suggestedReason', 'mark', 'feedback', 'text', 'key', 'token', 'password', 'privateKey', 'clientSecret']) {
        expect(check(`db.select({ x: t.${member} })`)).toHaveLength(1)
      }
      expect(check('sql`select suggested_mark from test_answer`')).toHaveLength(1)
      expect(check(`db.select({ x: classStudent.userId, y: oauthClient.name, z: apikey.lastRequest })`)).toEqual([])
    })

    it('(c) in page code, but not translation keys', () => {
      expect(check(`<p>{row.mark}</p>`)).toHaveLength(1)
      expect(check(`<ConfirmAction body={t('revoke.body')} label={t.rich("person.connections.token", {})} />`)).toEqual([])
      expect(check(`t(key).feedback`)).toHaveLength(1)
    })

    it('(d) select() without columns and the relational API', () => {
      expect(check(`db.select().from(user)`)).toHaveLength(1)
      expect(check(`db.selectDistinct( ).from(user)`)).toHaveLength(1)
      expect(check(`db.query.submission.findMany()`)).toHaveLength(1)
      expect(check(`db.select({ id: user.id }).from(user)`)).toEqual([])
    })

    it('(c) content and per-student columns on allowed tables', () => {
      for (const col of ['assignment.instructions', 'revisionOutcome.correct', 'submission.isLate', 'attendanceCheckIn.studentId', 'attendanceCheckIn.latitude', 'attendanceCheckIn.accuracyM']) {
        expect(check(`db.select({ x: ${col} })`)).toHaveLength(1)
      }
      expect(check('sql`select is_late, student_id from submission`')).toHaveLength(2)
      expect(check(`db.select({ x: testAnswer.optionId })`)).toHaveLength(1)
      expect(check('sql`select option_id from test_answer`')).toHaveLength(1)
    })

    it('(d) a whole table as a select value, by key, shorthand or spread', () => {
      expect(check(`db.select({ s: submission }).from(submission)`)).toHaveLength(1)
      expect(check(`db.select({ s: submission, id: user.id })`)).toHaveLength(1)
      expect(check(`db.select({ 'row': testAnswer })`)).toHaveLength(1)
      expect(check(`db.select({ submission }).from(submission)`)).toHaveLength(1)
      expect(check(`db.select({ id: user.id, testAnswer })`)).toHaveLength(1)
      expect(check(`db.selectDistinct({\n  attendanceCheckIn,\n})`)).toHaveLength(1)
      expect(check(`const cols = { s: submission }\ndb.select(cols)`)).toHaveLength(1)
      expect(check(`db.select({ ...submission })`)).toHaveLength(1)
      expect(check(`db.select({ id: user.id, userId: session.userId }).from(user)`)).toEqual([])
      expect(check(`await countWhere(db, user, where)`)).toEqual([])
    })

    it('(d) table introspection and aliases of other tables', () => {
      expect(check(`db.select(getTableColumns(testAnswer))`)).toHaveLength(1)
      expect(check(`const c = getTableConfig(submission)`)).toHaveLength(1)
      expect(check(`const s = alias(submission, 's')`)).toHaveLength(1)
      expect(check(`const a = alias(user, 'admin_user')`)).toEqual([])
    })
  })
})
