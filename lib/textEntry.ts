/**
 * Attributes that turn a phone keyboard's *own* intelligence back on.
 *
 * WHY THIS EXISTS
 *
 * Every prose field in Whisper — the chat composer, the anonymous-send box, the
 * public-feed composer and reply box, the bio, the support and feedback forms, the
 * AI assistant — was rendered with none of these attributes set. That reads like
 * "leave it to the browser", and on desktop Chrome it is: `spellcheck` defaults to
 * true there, so nobody noticed. It is not true everywhere. An Android WebView — the
 * thing the Capacitor build actually runs in — defaults `spellcheck` to **false**,
 * and with spellcheck off Gboard drops its suggestion strip and stops autocorrecting.
 * The result was a chat composer that gave no word suggestions and no autocorrect in
 * the installed app, and inconsistent behaviour across mobile browsers on the site.
 *
 * The fix is to stop relying on defaults and state the intent, once, here:
 *
 *   - `spellCheck` — the actual switch. Without it the suggestion strip never
 *     appears in a WebView, no matter what else is set.
 *   - `autoCorrect` — fixes typos as they are typed, which is what people expect
 *     from a messaging app and the reason nobody types carefully on a phone.
 *   - `autoCapitalize: "sentences"` — a capital after a full stop, not on every
 *     word (`"words"`) and not never (`"none"`). Correct for prose specifically.
 *
 * `autoComplete` is deliberately absent. Setting it to "off" is the usual instinct
 * for a message box, but some Android Chrome builds treat that as a blanket "no
 * assistance here" and suppress the suggestion strip along with form autofill —
 * which is the exact bug this constant exists to fix. Textareas get no autofill
 * dropdown anyway, so there is nothing to turn off and no reason to risk it.
 *
 * WHERE THIS MUST NOT BE USED
 *
 * Fields whose contents are not prose, where autocorrect actively corrupts input:
 *
 *   - the username field in `app/profile/page.tsx` — a handle is not a word, and
 *     autocapitalising it would fight the lowercase normaliser on every keystroke;
 *   - the wallet address field in `components/wallet/TransferCoinsModal.tsx` — it
 *     wants `autoCapitalize="characters"`, because a Whispers address is uppercase
 *     Crockford base32 and "correcting" it would break a transfer;
 *   - OTP, PIN and numeric fields, which use `inputMode` instead.
 *
 * Those three already set their own attributes explicitly. Leave them alone.
 */
export const PROSE_INPUT_PROPS = {
  autoCorrect: "on",
  autoCapitalize: "sentences",
  spellCheck: true,
} as const;
