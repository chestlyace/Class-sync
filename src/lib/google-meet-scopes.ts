/**
 * Google OAuth scopes and authorization-URL parameters for creating Meet spaces on a lecturer's behalf.
 * Pure constants (no server imports) so client and server code can share them.
 */
export const MEET_SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.settings',
] as const

/** Extra parameters for the "connect Google" link: a refresh token, a fresh consent screen, scopes added to earlier ones. */
export const MEET_LINK_PARAMS = {
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: 'true',
} as const
