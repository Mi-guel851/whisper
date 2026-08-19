# Whispers AI — server

The backend for the in-app assistant. It is the **only** place in this repository
that touches the Gemini API key.

```
browser / Capacitor WebView
        │  POST /api/whispers-ai        (user's Supabase JWT in Authorization)
        ▼
app/api/whispers-ai/route.ts           (Vercel, Node runtime)
        │  x-goog-api-key: GEMINI_API_KEY
        ▼
generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent
```

The browser never sees `GEMINI_API_KEY`, never sees the model id, and never calls
Google. Both are read at request time from the server environment:

```ts
process.env.GEMINI_API_KEY      // required
process.env.GEMINI_CHAT_MODEL   // optional, defaults to gemini-flash-latest
```

Neither is hardcoded, logged, or included in any response body — including error
bodies. See [Why the key can't leak](#why-the-key-cant-leak).

## Files

| File | What it owns |
| --- | --- |
| `../../../app/api/whispers-ai/route.ts` | The request pipeline: validation, auth, rate limits, the call |
| `config.ts` | **Every tunable number**, plus the user-facing copy. Change limits here |
| `knowledge.ts` | What the assistant knows about Whisper, its rules, and the scope gate |
| `gemini.ts` | The one place the key is used; upstream error mapping |
| `rateLimit.ts` | In-memory + durable per-user limits |
| `validate.ts` | Untrusted-input parsing for the question, history and page context |

Nothing in this directory may be imported from a client component. The route
handler is the only consumer.

## Request

`POST /api/whispers-ai` with the user's Supabase access token in `Authorization`.
Unlike `functions.invoke`, a plain `fetch` does not attach it — `lib/ai/whispersAi.ts`
does that by hand from `getCachedSession()`.

```json
{
  "message": "How do I transfer coins?",
  "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }],
  "context": { "page": "coins", "section": "transfer" }
}
```

`context` is limited to two short lowercase labels and is optional. No message
bodies, emails, usernames, ids, balances or tokens are ever sent as context — see
`lib/ai/pageContext.ts` for what is allowed through and why. A `userId` in the body
is ignored; the identity comes from the verified JWT and nothing else.

## Response

One shape, always:

```json
{ "ok": true,  "reply": "..." }
{ "ok": false, "code": "rate_limited", "message": "...", "retryable": true, "retryAfterSeconds": 47 }
```

Codes: `unauthenticated`, `bad_request`, `empty`, `too_long`, `rate_limited`,
`daily_limit`, `in_flight`, `timeout`, `configuration_error`, `provider_auth`,
`model_unavailable`, `blocked`, `unavailable`. The client adds `offline` locally.

## Setting it up on Vercel

1. Vercel dashboard → your Whisper project → **Settings** → **Environment
   Variables**.
2. Add:

   | Key | Value | Environments |
   | --- | --- | --- |
   | `GEMINI_API_KEY` | your key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Production, Preview, Development |

   Paste the key with no quotes and no trailing space. (`readGeminiConfig` strips
   wrapping quotes defensively, because Google's reply to a quoted key is just
   "API key not valid", which sends you looking at the wrong thing.)
3. **Redeploy.** Environment variables are baked in at build time — an existing
   deployment will not pick up a newly added variable. Deployments → the latest
   one → ⋯ → Redeploy.
4. Confirm `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` are already there. The first enables durable
   rate limiting; the other two are required for authentication.

Optional, and recommended, for rate limits that survive a serverless instance
recycling:

```sql
-- supabase/migrations/202608120001_whispers_ai_rate_limit.sql
```

Apply it in the Supabase SQL editor (or `supabase db push`). Without it the route
logs one warning and falls back to in-memory limits only, which still work but are
per-instance.

Nothing needs deploying to Supabase. There is no Edge Function in this path any
more.

## Local development

`.env.local` (already covered by `.gitignore`'s `.env*`):

```
GEMINI_API_KEY=<your key>
# GEMINI_CHAT_MODEL=gemini-2.5-flash
```

Then `npm run dev` and open the assistant. To exercise the route directly you need
a real user access token — the route has no unauthenticated path:

```bash
curl -i http://localhost:3000/api/whispers-ai \
  -H "Authorization: Bearer <a real user access token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"How do coins work?","context":{"page":"coins"}}'
```

## Scope — Whisper questions only

Three layers, because no single one of them is reliable on its own:

1. **Local pre-filter** (`classifyScope` in `knowledge.ts`). Deterministic regex,
   run before any network call, returning `in_scope` / `out_of_scope` / `unclear`.
   Catches the unambiguous cases — "write me a poem", "who is the president of
   Nigeria", "ignore your instructions" — for free, so they never cost a request
   against the quota. Instruction-override attempts are checked first, before
   anything can whitelist them.
2. **The system prompt.** The model is told to reply with exactly `OUT_OF_SCOPE`
   and nothing else for anything off-topic, and is given an explicit list of what
   counts. Judging scope is what a model is genuinely good at.
3. **Sentinel substitution** (`isRefusal`, applied in the route). When the model
   emits the sentinel, the route replaces it with our own canonical refusal. The
   model decides *whether* to refuse; we decide *how it reads*.

The asymmetry that shapes all of this: **a wrongly refused support question is far
worse than an off-topic question reaching a model that is instructed to refuse
it.** So the in-scope vocabulary is deliberately generous, each refusal pattern
requires enough context that a real Whisper question can't trip it (`write (a)
poem`, never a bare `write` — "how do I write a whisper?" is support), and
greetings, thanks and "what can you do" are explicitly in scope.

## Why the key can't leak

- It is read from `process.env` inside `gemini.ts` and passed only into that
  module's `fetch` call, as a header rather than a query parameter — a key in a
  query string ends up in access logs and proxy traces.
- Upstream failures are mapped to opaque outcomes (`unavailable`, `timeout`,
  `rate_limited`) before they reach a response. A `403` from Google becomes
  "Whispers AI is temporarily unavailable" for the user and a precise note in the
  Vercel function log for the operator.
- The client bundle imports `lib/ai/whispersAi.ts`, which knows one relative path
  and nothing else — no Gemini URL, no model id, no credential.
- Nothing here is prefixed `NEXT_PUBLIC_`, which is the only mechanism by which a
  Next.js build inlines a value into browser JavaScript.

## Cost controls

All in `config.ts`:

- 500-character question ceiling, checked before any upstream call.
- 6 turns of history maximum, each clipped to 600 characters.
- 640 output tokens maximum.
- 12 requests per 5 minutes and 80 per day, per user.
- One in-flight request per user — a second question while the first is running is
  refused rather than duplicated.
- The system prompt is assembled per request from a compact always-on index plus at
  most four detail blocks chosen by page and keyword, rather than shipping the
  whole knowledge base every turn.
- `thinkingConfig: { thinkingBudget: 0 }` on the Flash models. On the 2.5 family
  thinking tokens are billed against `maxOutputTokens`, so a model left to think
  freely can spend the entire budget reasoning and return `MAX_TOKENS` with no text
  at all. Pro rejects `0` (its minimum is 128), so the field goes only to Flash
  ids — and if a Flash model ever rejects it too, the retry ladder drops it rather
  than failing the question.

## Model selection and the fallback ladder

The default is the rolling alias `gemini-flash-latest`, not a pinned id. That is a
scar, not a preference: the default used to be `gemini-2.5-flash`, Google retired
it, and every request came back 404 — which the app surfaced as "Whispers AI is
being updated", a message indistinguishable from a transient blip. Nothing pointed
at the real cause until someone read the function log.

So `gemini.ts` now walks a ladder (`MODEL_LADDER`), configured model first:

```
gemini-flash-latest → gemini-3.5-flash → gemini-3-flash → gemini-2.5-flash → gemini-flash-lite-latest
```

- **404** on a model → try the next candidate. A retirement heals itself.
- **400** that isn't about the key → retry the same model once without the optional
  `thinkingConfig` / `safetySettings` fields, since those are what a new model
  family is most likely to have renamed. Still 400 → next candidate.
- **401 / 403 / 429 / 5xx / timeout** → terminal. Retrying can't help, and on 429
  it would make things worse.

Capped at `MAX_ATTEMPTS = 4` upstream calls per question, and the whole ladder
shares one 20-second deadline — retries with their own budgets would add up past
`maxDuration` and let the platform kill the invocation.

When a fallback answers, the log names it and suggests pinning
`GEMINI_CHAT_MODEL` to skip the wasted attempts on later requests.

To see what a key can actually reach:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models" \
  -H "x-goog-api-key: $GEMINI_API_KEY" | grep -o '"name": "models/[^"]*"'
```

## Two timeouts, in the right order

`maxDuration = 30` on the route, `GEMINI_TIMEOUT_MS = 20_000` in `config.ts`. Ours
has to fire first: if Vercel kills the invocation, the browser receives the
platform's gateway error page instead of our JSON envelope, and every friendly
message in `MESSAGES` is bypassed.
