import { handleSnsPostDefault } from '@/server/whatsapp/default-db'

export const dynamic = 'force-dynamic'

/**
 * Receives what AWS End User Messaging Social publishes to our SNS topic: messages people send to
 * the WhatsApp number and delivery statuses. SNS posts JSON as text/plain, so the raw body is read
 * and checked against SNS's signature. Not a user-facing route: no cookies, no sign-in.
 */
export async function POST(request: Request) {
  const { status, body } = await handleSnsPostDefault(await request.text())
  return new Response(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
