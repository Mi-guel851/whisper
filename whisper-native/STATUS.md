# whisper-native — where the app stands

The Expo app is a port of the Whisper web app, screen for screen. It talks to the
same Supabase project and the same `/api/*` routes as the site; it creates no
tables, no policies, and no Edge Functions of its own.

```
branch   arena/01a0950c-whisper
tip      bcf4a8f   (pushed)
tree     040000 tree afac34c   whisper-native  — a real directory, 79 tracked files, no gitlink
build    npx tsc --noEmit clean  ·  expo export: android 1503 modules, ios 1498 modules
```

## Verified in this pass

| Requirement | Result |
| --- | --- |
| `whisper-native` is a real directory on the pushed branch | `040000 tree afac34c…`, 79 tracked files |
| No `160000` gitlink anywhere in the repo | 0 gitlinks |
| No `whisper-native` entry in `.gitmodules` | no `.gitmodules` in the tree |
| The merge of `origin/main` (`827aad0`) is not undone | `e97026c` has both parents — `56e0db6` and `827aad0` |
| `origin/main` can fast-forward | `merge-base --is-ancestor origin/main HEAD` → true |
| Type-checks | `tsc --noEmit` and `--noUnusedLocals` both clean |
| Bundles | android 1503 modules · ios 1498 modules |
| The app's files are kept | 79 files; the expo-router stub's 21 files are gone (recoverable from `827aad0`) |
| Unrelated web code untouched | nothing outside `whisper-native/` changed |

## Two things only you can do

1. **Payment keys** — the Paystack public key is not in the repo. Set
   `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY` in `whisper-native/.env` (copy `.env.example`)
   before the Coin Store can charge. Verification is server-side only:
   `/api/paystack/verify` → `credit_verified_payment`. There is no client credit
   path, deliberately.
2. **Push on a device** — `google-services.json` is committed, but a real FCM
   token only arrives on a physical device or a Play-services emulator. Sign in,
   accept the token, and check `profiles.push_token` updated.

Supabase URL and anon key are already in the ignored `.env` (recovered from the
stub), so the app talks to the live backend as soon as it starts:

```
npx expo start          # then press a / i
```
