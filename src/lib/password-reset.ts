/**
 * How long one address waits between reset emails. The server skips a send inside this window
 * (stopping inbox floods and saving the daily email quota), and "Check your inbox" counts it down
 * before offering "Send again", so the button never promises an email that won't go out.
 */
export const RESET_RESEND_SECONDS = 120
