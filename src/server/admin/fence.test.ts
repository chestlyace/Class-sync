import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The data fence: admins see counts across the platform and account facts about people, never
// students' marks, submissions, answers, content, per-student attendance or credentials. This
// test reads the admin code as text, so a new query cannot cross the fence without failing here.

const ADMIN_DIR = path.resolve(process.cwd(), 'src/server/admin')
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
]
const FORBIDDEN_MEMBER_RE = new RegExp(`\\.(${FORBIDDEN_MEMBERS.join('|')})\\b`, 'g')
/** The same columns by their SQL names, for raw `sql` fragments. */
const FORBIDDEN_SQL_COLUMN_RE =
  /\b(suggested_mark|suggested_reason|suggested_feedback|storage_key|body_text|private_key|client_secret)\b/g

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return walk(full)
    return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [full] : []
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

  // (c) Forbidden columns, by property name or SQL name.
  for (const m of src.matchAll(FORBIDDEN_MEMBER_RE)) out.push(`${rel}: reads .${m[1]}`)
  for (const m of src.matchAll(FORBIDDEN_SQL_COLUMN_RE)) out.push(`${rel}: names column ${m[1]}`)

  // (d) Whole-row reads: select() without columns, or the relational query API.
  if (/\.select(?:Distinct)?\(\s*\)/.test(src)) out.push(`${rel}: select() without columns`)
  if (/\.query\.\w+\.find(?:First|Many)\b/.test(src)) out.push(`${rel}: relational query API`)

  return out
}

describe('admin data fence', () => {
  const files = walk(ADMIN_DIR)

  it('finds the admin code', () => {
    expect(files.map((f) => path.basename(f))).toEqual(expect.arrayContaining(['actions.ts', 'queries.ts']))
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

    it('(d) select() without columns and the relational API', () => {
      expect(check(`db.select().from(user)`)).toHaveLength(1)
      expect(check(`db.selectDistinct( ).from(user)`)).toHaveLength(1)
      expect(check(`db.query.submission.findMany()`)).toHaveLength(1)
      expect(check(`db.select({ id: user.id }).from(user)`)).toEqual([])
    })
  })
})
