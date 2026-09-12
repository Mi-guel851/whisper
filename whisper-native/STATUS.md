# whisper-native — where the app stands

The Expo app is a port of the Whisper web app, screen for screen. It talks to the
same Supabase project and the same `/api/*` routes as the site; it creates no
tables, no policies, and no Edge Functions of its own.

```
branch   arena/01a09583-whisper
router   expo-router (file-based), app/ is the route tree
build    npx tsc --noEmit clean · expo export (android) succeeds — every import resolves
```

## Verified in this pass

| Requirement | Result |
| --- | --- |
| Routing structure | `app/index.tsx` forks on the session; `(auth)/` guards itself; `(tabs)/` carries the glass tab bar; coins, create-whisper, conversation, whisper-detail, settings, forgot-password (+ saved, u) open over the tabs |
| Session management | `lib/session.tsx`: `getSession()` → `onAuthStateChange` → context; AsyncStorage persistence |
| Data layer | `lib/` mirrors the web app's queries 1:1 — `public_feed_page`, `inbox_conversations`, `voice-messages`, `credit_verified_payment`, and the rest |
| Type-check | `npx tsc --noEmit` — zero errors |
| Bundle | `npx expo export --platform android` — all 19 route modules resolved and compiled |
| Placeholders | none — no TODO/FIXME anywhere in `app/` |

## The route tree

```
app/
├── _layout.tsx            providers: gesture handler → safe area → session → toast → paystack
├── index.tsx              session ? (tabs)/feed : (auth)/login
├── (auth)/                _layout guards: signed-in users are redirected to the tabs
│   ├── onboarding.tsx     animated gradient logo · "Say it. Anonymously." · Get Started
│   ├── login.tsx          signInWithPassword · inline errors · forgot-password link
│   └── signup.tsx         signUp · username in metadata · email-confirmation notice
├── (tabs)/
│   ├── _layout.tsx        floating dark-glass tab bar, gradient pill on the active tab
│   ├── feed.tsx           sorts · topics · search · optimistic likes · threads · FAB
│   ├── dms.tsx            conversations · previews · unread counts · the 40-coin lock
│   ├── notifications.tsx  whispers (public.messages) + alerts (public.notifications)
│   └── profile.tsx        avatar upload · whisper link · coin badge · your posts · edit sheet
├── coins.tsx              4 packages in ₦ · Paystack popup · verify via /api/paystack/verify
├── create-whisper.tsx     composer · photo or poll · topic chips · anonymous locked on
├── conversation.tsx       chat bubbles · voice notes (voice-messages bucket) · view-once
├── whisper-detail.tsx     root card · replies · pinned reply composer · coin tip sheet
├── settings.tsx           push toggles (6, stored on profiles) · wallet address · logout
├── forgot-password.tsx    username + recovery phrase → /api/reset-with-phrase
├── saved.tsx              saved posts (bookmark) — pointer, not archive
└── u.tsx                  another user's profile · report / block
```

## Two things only you can do

1. **Payment keys** — the Paystack public key is not in the repo. Set
   `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY` in `whisper-native/.env` (copy `.env.example`)
   before the Coin Store can charge. Verification is server-side only:
   `/api/paystack/verify` → `credit_verified_payment`. There is no client credit
   path, deliberately.
2. **Push on a device** — `google-services.json` is committed, but a real FCM
   token only arrives on a physical device or a Play-services emulator. Sign in,
   accept the token, and check `profiles.push_token` updated.

Supabase URL and anon key are in the ignored `.env`, so the app talks to the live
backend as soon as it starts:

```
npx expo start          # then press a / i
```

`EXPO_PUBLIC_*` values are inlined at build time, so **changing `.env` requires
restarting the bundler** (`npx expo start --clear`).
