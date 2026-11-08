import type { getCourseNotes } from '@/server/notes/read'

type NotesData = Awaited<ReturnType<typeof getCourseNotes>>

/** Placeholder until the student notes screens land; Task 6 replaces this file. */
export function StudentNotes({ data }: { data: NotesData }) {
  return (
    <ul className="flex flex-col gap-2">
      {data.topics.map((topic) => (
        <li key={topic.id} className="font-medium">
          {topic.title}
        </li>
      ))}
    </ul>
  )
}
