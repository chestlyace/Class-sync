import { check, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { user } from './auth'
import { school } from './school'

export const CLASS_STUDENT_STATUSES = ['active', 'removed'] as const
export type ClassStudentStatus = (typeof CLASS_STUDENT_STATUSES)[number]

// `class` is a reserved word in TS, hence the trailing underscore on the export.
export const class_ = pgTable('class', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  schoolId: text('school_id')
    .notNull()
    .references(() => school.id),
  name: text('name').notNull(),
  academicYear: text('academic_year').notNull(), // e.g. "2026/27"
  studentCode: text('student_code').notNull().unique(),
  lecturerCode: text('lecturer_code').notNull().unique(),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const classLecturer = pgTable(
  'class_lecturer',
  {
    classId: text('class_id')
      .notNull()
      .references(() => class_.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.classId, t.userId] })],
)

export const classStudent = pgTable(
  'class_student',
  {
    classId: text('class_id')
      .notNull()
      .references(() => class_.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    matricule: text('matricule').notNull(),
    status: text('status', { enum: CLASS_STUDENT_STATUSES }).notNull().default('active'),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.userId] }),
    unique('class_student_class_matricule_unique').on(t.classId, t.matricule),
    check('class_student_status_check', sql`${t.status} in ('active', 'removed')`),
  ],
)
