import { handleCallback } from '@vercel/queue'
import { runMarkingJobDefault } from '@/server/assignments/ai/default-db'
import type { MarkingMessage } from '@/server/assignments/ai/queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Acked when this resolves (a failed model call is recorded on the submission, not retried); a throw
// (a database error) makes the queue retry the message.
// The delivery count lets the job stop calling the model for a message whose earlier runs were cut off.
export const POST = handleCallback<MarkingMessage>(async (message, metadata) => {
  await runMarkingJobDefault(message, metadata.deliveryCount)
})
