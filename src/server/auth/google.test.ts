import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config, setConfigForTests } from '@/server/core/config'
import type { Ctx } from '@/server/core/context'
import type { Db } from '@/server/db'
import { account, user } from '@/server/db/schema'
import { createTestDb } from '@/test/db'
import { createAuth } from './auth'
import { googleCredentials, isGoogleSignInEnabled, signupFieldsFromOAuthState } from './google'
import { listSignInMethods } from './sign-in-methods'

const BASE = 'http://localhost:3000'
const GOOGLE = { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret' }

describe('googleCredentials', () => {
  it('needs both the client id and the secret', () => {
    expect(googleCredentials({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
    })
    expect(googleCredentials({ GOOGLE_CLIENT_ID: 'id' })).toBeNull()
    expect(googleCredentials({ GOOGLE_CLIENT_ID: ' ', GOOGLE_CLIENT_SECRET: 'secret' })).toBeNull()
    expect(isGoogleSignInEnabled({})).toBe(false)
  })
})

describe('signupFieldsFromOAuthState', () => {
  it('keeps only the role and locale that were sent', () => {
    expect(signupFieldsFromOAuthState({ role: 'student', locale: 'fr', callbackURL: '/' })).toEqual({
      role: 'student',
      locale: 'fr',
    })
    expect(signupFieldsFromOAuthState({ callbackURL: '/' })).toEqual({})
    expect(signupFieldsFromOAuthState(null)).toEqual({})
  })
})

/** An unsigned ID token: Better Auth reads the profile from the token endpoint's answer. */
function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.`
}

describe('auth: Google sign-in', () => {
  const original = config.requireEmailVerification
  let db: Db
  let auth: ReturnType<typeof createAuth>
  /** The Google profile the stubbed token endpoint answers with. */
  let profile: { sub: string; email: string; name: string }

  function cookiesOf(res: Response): string {
    return res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
  }

  function post(path: string, body: unknown, cookie?: string) {
    return auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    )
  }

  /** Starts a Google flow and comes back from Google: the callback's redirect response. */
  async function viaGoogle(path: '/sign-in/social' | '/link-social', body: Record<string, unknown>, cookie?: string) {
    const start = await post(path, { provider: 'google', ...body }, cookie)
    expect(start.status).toBe(200)
    const { url } = (await start.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')!
    const stateCookie = cookiesOf(start)
    return auth.handler(
      new Request(`${BASE}/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`, {
        headers: { cookie: [cookie, stateCookie].filter(Boolean).join('; ') },
      }),
    )
  }

  async function userByEmail(email: string) {
    const [row] = await db.select().from(user).where(eq(user.email, email))
    return row
  }

  async function googleAccountOf(userId: string) {
    return db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'google')))
  }

  beforeAll(async () => {
    setConfigForTests({ requireEmailVerification: true })
    db = await createTestDb()
    auth = createAuth(db, {
      baseURL: BASE,
      secret: 'test-secret-test-secret-test-secret-123',
      nextCookies: false,
      google: GOOGLE,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (!url.startsWith('https://oauth2.googleapis.com/token')) throw new Error(`unexpected fetch ${url}`)
        return Response.json({
          access_token: 'access',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken({ ...profile, email_verified: true, aud: GOOGLE.clientId, iss: 'https://accounts.google.com' }),
        })
      }),
    )
  })

  afterEach(() => {
    profile = { sub: '', email: '', name: '' }
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    setConfigForTests({ requireEmailVerification: original })
  })

  it('creates the account from the sign-up page with the chosen role and locale, already verified', async () => {
    profile = { sub: 'g-new', email: 'new@gmail.com', name: 'New Student' }
    const res = await viaGoogle('/sign-in/social', {
      callbackURL: '/join',
      errorCallbackURL: '/sign-up',
      requestSignUp: true,
      additionalData: { role: 'student', locale: 'fr' },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/join')
    expect(cookiesOf(res)).toContain('session_token')
    const row = await userByEmail('new@gmail.com')
    expect(row).toMatchObject({ role: 'student', locale: 'fr', emailVerified: true })
  })

  it('refuses a role other than lecturer or student', async () => {
    profile = { sub: 'g-admin', email: 'admin@gmail.com', name: 'Sneaky' }
    const res = await viaGoogle('/sign-in/social', {
      callbackURL: '/',
      errorCallbackURL: '/sign-up',
      requestSignUp: true,
      additionalData: { role: 'admin' },
    })
    expect(res.headers.get('location')).toMatch(/^\/sign-up\?error=/)
    expect(await userByEmail('admin@gmail.com')).toBeUndefined()
  })

  it('sends an unknown Google account from the sign-in page back with signup_disabled', async () => {
    profile = { sub: 'g-unknown', email: 'unknown@gmail.com', name: 'Unknown' }
    const res = await viaGoogle('/sign-in/social', { callbackURL: '/', errorCallbackURL: '/sign-in' })
    expect(res.headers.get('location')).toBe('/sign-in?error=signup_disabled')
    expect(await userByEmail('unknown@gmail.com')).toBeUndefined()
  })

  it('signs a returning Google user in from the sign-in page', async () => {
    profile = { sub: 'g-new', email: 'new@gmail.com', name: 'New Student' }
    const res = await viaGoogle('/sign-in/social', { callbackURL: '/dashboard', errorCallbackURL: '/sign-in' })
    expect(res.headers.get('location')).toBe('/dashboard')
    expect(cookiesOf(res)).toContain('session_token')
  })

  it('joins a verified email account with the same address', async () => {
    const signUp = await post('/sign-up/email', {
      name: 'Lec',
      email: 'lec@gmail.com',
      password: 'correct-horse-9',
      role: 'lecturer',
    })
    expect(signUp.status).toBe(200)
    const lec = await userByEmail('lec@gmail.com')
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, lec.id))

    profile = { sub: 'g-lec', email: 'lec@gmail.com', name: 'Lec' }
    const res = await viaGoogle('/sign-in/social', { callbackURL: '/', errorCallbackURL: '/sign-in' })
    expect(res.headers.get('location')).toBe('/')
    expect(await googleAccountOf(lec.id)).toHaveLength(1)
    expect((await userByEmail('lec@gmail.com')).role).toBe('lecturer')
  })

  it('does not join an unverified email account (account_not_linked)', async () => {
    await post('/sign-up/email', { name: 'Squat', email: 'victim@gmail.com', password: 'correct-horse-9', role: 'student' })
    const squatter = await userByEmail('victim@gmail.com')
    expect(squatter.emailVerified).toBe(false)

    profile = { sub: 'g-victim', email: 'victim@gmail.com', name: 'Victim' }
    const res = await viaGoogle('/sign-in/social', {
      callbackURL: '/',
      errorCallbackURL: '/sign-up',
      requestSignUp: true,
      additionalData: { role: 'student' },
    })
    expect(res.headers.get('location')).toBe('/sign-up?error=account_not_linked')
    expect(await googleAccountOf(squatter.id)).toHaveLength(0)
  })

  it('refuses a suspended account', async () => {
    const student = await userByEmail('new@gmail.com')
    await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, student.id))
    profile = { sub: 'g-new', email: 'new@gmail.com', name: 'New Student' }
    const res = await viaGoogle('/sign-in/social', { callbackURL: '/', errorCallbackURL: '/sign-in' })
    expect(res.headers.get('location')).toMatch(/^\/sign-in\?error=ACCOUNT_SUSPENDED(&|$)/)
    expect(cookiesOf(res)).not.toContain('session_token=')
    await db.update(user).set({ suspendedAt: null }).where(eq(user.id, student.id))
  })

  it('links a Google account with another address from settings, then signs in with it', async () => {
    const signUp = await post('/sign-up/email', {
      name: 'School',
      email: 'student@school.cm',
      password: 'correct-horse-9',
      role: 'student',
    })
    const me = await userByEmail('student@school.cm')
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, me.id))
    const signIn = await post('/sign-in/email', { email: 'student@school.cm', password: 'correct-horse-9' })
    expect(signUp.status).toBe(200)
    const cookie = cookiesOf(signIn)

    profile = { sub: 'g-personal', email: 'personal@gmail.com', name: 'School' }
    const linked = await viaGoogle('/link-social', { callbackURL: '/settings', errorCallbackURL: '/settings' }, cookie)
    expect(linked.headers.get('location')).toBe('/settings')
    expect(await googleAccountOf(me.id)).toHaveLength(1)

    const res = await viaGoogle('/sign-in/social', { callbackURL: '/', errorCallbackURL: '/sign-in' })
    expect(res.headers.get('location')).toBe('/')
    // Signed into the school account: no second account for the Gmail address.
    expect(await userByEmail('personal@gmail.com')).toBeUndefined()
  })

  it('lists sign-in methods: password and Google, or Google only', async () => {
    const ctxFor = async (email: string) => ({ db, user: (await userByEmail(email)) as unknown as Ctx['user'] })
    const school = await ctxFor('student@school.cm')
    expect(await listSignInMethods(school)).toEqual({
      password: true,
      googleAccountId: (await googleAccountOf(school.user.id))[0].id,
    })
    const googleOnly = await ctxFor('new@gmail.com')
    expect(await listSignInMethods(googleOnly)).toEqual({
      password: false,
      googleAccountId: (await googleAccountOf(googleOnly.user.id))[0].id,
    })
  })

  it('refuses to unlink Google when it is the only way to sign in', async () => {
    profile = { sub: 'g-new', email: 'new@gmail.com', name: 'New Student' }
    const signIn = await viaGoogle('/sign-in/social', { callbackURL: '/', errorCallbackURL: '/sign-in' })
    const [google] = await googleAccountOf((await userByEmail('new@gmail.com')).id)
    const res = await post('/unlink-account', { accountId: google.id }, cookiesOf(signIn))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'FAILED_TO_UNLINK_LAST_ACCOUNT' })
    expect(await googleAccountOf((await userByEmail('new@gmail.com')).id)).toHaveLength(1)
  })

  it('unlinks Google from an account that keeps its password', async () => {
    const me = await userByEmail('student@school.cm')
    const signIn = await post('/sign-in/email', { email: 'student@school.cm', password: 'correct-horse-9' })
    const [google] = await googleAccountOf(me.id)
    const res = await post('/unlink-account', { accountId: google.id }, cookiesOf(signIn))
    expect(res.status).toBe(200)
    expect(await googleAccountOf(me.id)).toHaveLength(0)
  })
})
