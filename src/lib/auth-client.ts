import { inferAdditionalFields } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { Auth } from '@/server/auth/auth'

// Same origin as the app, so no baseURL is needed. `import type` keeps server code
// out of the client bundle.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<Auth>()],
})
