import type { Db } from '@/server/db'
import { createAuth } from '@/server/auth/auth'

export const TEST_ORIGIN = 'http://localhost:3000'

/** A Better Auth instance (with the MCP plugins) on a test database. */
export function createTestAuth(db: Db) {
  return createAuth(db, {
    baseURL: TEST_ORIGIN,
    secret: 'test-secret-test-secret-test-secret-123',
    nextCookies: false,
  })
}
