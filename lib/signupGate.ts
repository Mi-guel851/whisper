/**
 * Signup gate — new account creation is closed while Whisper is in testing.
 *
 * One flag, read from one place, so closing or reopening signups is a single
 * change rather than an audit of every auth entry point.
 *
 * WHY THIS ISN'T JUST A DISABLED BUTTON
 *
 * Supabase's Google OAuth is sign-in and sign-up in one call: `signInWithOAuth`
 * creates the `auth.users` row when the Google account is new. Both /signup and
 * /login call it with the same options, so hiding the button on /signup alone
 * would leave /login as an unlocked side door to the exact flow being closed.
 *
 * And on web, that call *navigates away* — control returns at the `redirectTo`
 * URL, not in the handler — so a check written after it never runs.
 *
 * That leaves /complete-profile as the only real chokepoint: it is where every
 * newly created account lands, on web and native alike, and no finished account
 * ever reaches it (it redirects completed profiles straight to /dashboard). So
 * the gate lives there, and the button on /signup is the courtesy that stops a
 * user from bouncing through Google before being told no.
 *
 * WHO CAN STILL GET IN
 *
 * `profile_completed` is the line. Accounts that finished onboarding — the test
 * accounts — log in normally through either email/password or Google, and are
 * never affected by any of this. Only an account that has *not* finished is
 * treated as a signup in progress and turned away.
 */

/**
 * Set `NEXT_PUBLIC_SIGNUPS_OPEN=true` to reopen signups without a deploy of new
 * code. Anything else — unset included — keeps them closed, so the gate fails
 * safe: a typo in the env var leaves signups shut rather than silently open.
 */
export const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === "true";

/** Closed is the interesting state, so most call sites read better as this. */
export const SIGNUPS_CLOSED = !SIGNUPS_OPEN;

/** Shown on the gate screen. Kept here so every surface says the same thing. */
export const SIGNUP_GATE_COPY = {
  title: "Coming Soon",
  body:
    "Whisper is in private testing right now, so new accounts aren't open just yet. Leave your name at the door — we're opening to everyone soon.",
  note: "Already have an account? You can still log in as normal.",
} as const;
