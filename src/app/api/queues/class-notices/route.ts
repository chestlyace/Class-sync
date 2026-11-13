import { handleCallback } from '@vercel/queue'
import { handleNoticeDefault } from '@/server/schedule/default-db'
import type { NoticeMessage } from '@/server/schedule/queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Acked when this resolves; a throw (a database error) makes the queue retry the message.
export const POST = handleCallback<NoticeMessage>(async (message) => {
  await handleNoticeDefault(message)
})
