import { handleCallback } from '@vercel/queue'
import { runMarkingJobDefault } from '@/server/assignments/ai/default-db'
import type { MarkingMessage } from '@/server/assignments/ai/queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Acked when this resolves (a failed model call is recorded on the submission, not retried); a throw
// (a database error) makes the queue retry the message.
export const POST = handleCallback<MarkingMessage>(async (message) => {
  await runMarkingJobDefault(message)
})
