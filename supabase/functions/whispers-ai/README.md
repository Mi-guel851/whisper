# `whispers-ai`

The server side of Whispers AI, the in-app assistant. It is the **only** place in
this repository that touches the Hugging Face inference token.

```
browser  ──►  supabase.functions.invoke("whispers-ai")  ──►  this function  ──►  Hugging Face
                     (user's Supabase JWT)                    (HF_API_TOKEN)
```

The browser never sees `HF_API_TOKEN`, never sees `HF_CHAT_MODEL`, and never calls
Hugging Face. Both values are read at request time from the function's
environment:

```ts
Deno.env.get("HF_API_TOKEN")
Deno.env.get("HF_CHAT_MODEL")
```

`HF_CHAT_MODEL` should be a Hugging Face router chat model id such as
`openai/gpt-oss-20b:fastest`. If it is missing or malformed the function falls
back to that fast in-app-assistant default and logs the configuration issue
server-side; `HF_API_TOKEN` is still required and has no fallback.

Neither is hardcoded, logged, or included in any response body — including error
bodies. See "Why the token can't leak" below.

## Files

| File | What it owns |
| --- | --- |
| `index.ts` | The request pipeline: CORS, validation, auth, rate limits, the call |
| `config.ts` | **Every tunable number.** Change limits here |
| `knowledge.ts` | What the assistant is allowed to know about Whisper, and its rules |
| `huggingface.ts` | The one place the token is used; upstream error mapping |
| `rateLimit.ts` | In-memory + durable per-user limits |
| `validate.ts` | Untrusted-input parsing for the question, history and page context |

## Request

`POST` with the user's Supabase access token in `Authorization`. `functions.invoke`
attaches it automatically.

```json
{
  "message": "How do I transfer coins?",
  "history": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }],
  "context": { "page": "coins", "section": "transfer" }
}
```

`context` is limited to two short lowercase labels and is optional. No message
bodies, emails, usernames, ids, balances or tokens are ever sent as context — see
`lib/ai/pageContext.ts` for what is allowed through and why.

## Response

One shape, always:

```json
{ "ok": true,  "reply": "..." }
{ "ok": false, "code": "rate_limited", "message": "...", "retryable": true, "retryAfterSeconds": 47 }
```

Codes: `unauthenticated`, `bad_request`, `empty`, `too_long`, `rate_limited`,
`daily_limit`, `in_flight`, `timeout`, `configuration_error`,
`provider_auth`, `model_unavailable`, `unavailable`.

## Deploying

Secrets already exist in the linked Supabase project, so this is the whole job:

```bash
supabase functions deploy whispers-ai
```

Do **not** re-run `supabase secrets set` for `HF_API_TOKEN` / `HF_CHAT_MODEL` —
they are already configured, and re-setting them is how a working deployment gets
broken by a typo.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform. Nothing else is needed.

Optional but recommended, for rate limits that survive an isolate recycle:

```bash
supabase db push   # applies supabase/migrations/202608120001_whispers_ai_rate_limit.sql
```

Without it the function logs one warning and falls back to in-memory limits only.

## Running it locally

Local `supabase functions serve` runs in a container that has **no** access to
your project's production secrets. That is the only reason a local secret file
would ever be needed. Nothing about local development requires putting the
Hugging Face token into the Next.js `.env.local`, into Vercel, or into any
`NEXT_PUBLIC_*` variable — doing so would ship it to the browser.

If you want to exercise the function locally, and only then:

1. Create `supabase/functions/.env` (already covered by `.gitignore`, and named
   explicitly there so it can't be added by accident):

   ```
   HF_API_TOKEN=<your Hugging Face token>
   HF_CHAT_MODEL=<the same model id as the production secret>
   ```

2. Serve it:

   ```bash
   supabase functions serve whispers-ai --env-file supabase/functions/.env
   ```

3. Point the app at the local stack, or call it directly:

   ```bash
   curl -i http://127.0.0.1:54321/functions/v1/whispers-ai \
     -H "Authorization: Bearer <a real user access token>" \
     -H "Content-Type: application/json" \
     -d '{"message":"How do coins work?","context":{"page":"coins"}}'
   ```

Skip all of this and deploy instead if you'd rather not have the token on disk at
all — the deployed function reads it from Supabase secrets and works immediately.

## Why the token can't leak

- It is read from `Deno.env` inside `huggingface.ts` and passed only into that
  module's `fetch` call. It is never returned to a caller, never put in a log
  line, and never interpolated into an error message.
- Upstream failures are mapped to opaque outcomes (`unavailable`, `timeout`,
  `rate_limited`) before they reach a response. A `401` from Hugging Face becomes
  "Whispers AI is temporarily unavailable" for the user and a note in the function
  log for the operator.
- The client bundle imports `lib/ai/whispersAi.ts`, which knows the function name
  and nothing else — no Hugging Face URL, no model id, no credential.
- Nothing here is prefixed `NEXT_PUBLIC_`, which is the only mechanism by which a
  Next.js build inlines a value into browser JavaScript.

## Cost controls

All in `config.ts`:

- 500-character question ceiling, checked before any upstream call.
- 6 turns of history maximum, each clipped to 600 characters.
- 320 output tokens maximum.
- 12 requests per 5 minutes and 80 per day, per user.
- One in-flight request per user — a second question while the first is running
  is refused rather than duplicated.
- The system prompt is assembled per request from a compact always-on index plus
  at most four detail blocks chosen by page and keyword, rather than shipping the
  whole knowledge base every turn.
