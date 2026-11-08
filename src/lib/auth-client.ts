import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { Auth } from '@/server/auth/auth'

// Same origin as the app, so no baseURL is needed. `import type` keeps server code
// out of the client bundle. `oauthProviderClient` sends the signed OAuth query of the sign-in and
// consent pages along, so an assistant's authorization resumes after sign-in.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>(), oauthProviderClient()],
})
