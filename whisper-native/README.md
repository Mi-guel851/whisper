# Whisper — the native app

The Expo/React Native build of Whisper: the same product, the same Supabase
project, the same data — as a phone app.

It is a **second client of the existing backend**, not a second backend. There
is no new table, policy, RPC or Edge Function anywhere in this folder. Every
query is a copy of the one the web app already makes, and the two clients share
the coin ledger, the whisks, the conversations and the notification rows.

---

## Run it

```bash
cd whisper-native
npm install
npx expo start
```

Then press `a` (Android), `i` (iOS) or scan the QR with Expo Go. Voice recording
and push need a development build rather than Expo Go:

```bash
npx expo run:android      # requires the Android SDK + a device/emulator
npx expo run:ios          # requires Xcode (macOS)
```

## Configure it

Copy `.env.example` to `.env` and fill it in. Nothing reaches the network
without at least the first two values.

| Variable | Needed for | Where it comes from |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | everything | Supabase → Project Settings → API |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | everything | same page, the `anon` key |
| `EXPO_PUBLIC_API_BASE_URL` | posting, photo claims, payments | the Vercel deployment (defaults to production) |
| `EXPO_PUBLIC_SITE_URL` | share links | the same deployment |
| `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY` | the coin store | Paystack → Settings → API Keys (`pk_live_…`) |
| `EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME` | photo uploads | Cloudinary dashboard |
| `EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | photo uploads when signing is unavailable | Cloudinary → Settings → Upload |

**The Android push configuration is already in the repository** —
`whisper-native/google-services.json` is a copy of `android/app/google-services.json`
from the Capacitor project, and it is for the package `com.whisper.app`, which is
the same package this app declares. Nothing needs to be downloaded for FCM to
work. (`app.json` still points at the file; deleting it breaks the Android build
with an explicit error rather than silently dropping push.)

`EXPO_PUBLIC_*` values are inlined at build time, so **changing `.env` requires
restarting the bundler** (`npx expo start --clear`). A stale bundle holding the
old key is the most common way "it works for me but not on the device" happens.

## What is where

```
App.tsx                 providers: gesture handler → safe area → session → toast → paystack
index.ts                registerRootComponent (no expo-router — React Navigation)
lib/                    data access, one file per surface, plus theme/format/errors/haptics
  supabase.ts           the client (AsyncStorage session, AppState refresh)
  feed.ts feedState.ts  the public feed: RPC-first, table fallback
  whispers.ts           anonymous whispers (public.messages) + paid sender hints
  dms.ts                conversations, direct messages, view-once claims
  notifications.ts      the durable alert history
  payments.ts (paystack) the coin checkout
  push.ts               device tokens, taps, channels
  badges.ts             the unread counts the tab bar shows
  session.tsx toast.tsx theme.ts identity.ts format.ts errors.ts uploads.ts
components/             the design system + shared pieces (see below)
screens/                the twelve screens
navigation/             RootNavigator, MainTabs, the typed param lists
```

Components worth knowing: `Background` (the gradient wash every screen sits on),
`GlassCard`, `GradientButton`/`IconButton`, `GradientText`, `Avatar`, `Screen`
(the shell: background + safe area + fade-in), `Sheet`/`ConfirmSheet`/`SheetRow`,
`Toggle`, `CoinBadge`, `Waveform`, `VoiceNotePlayer`, `VoiceRecorderPanel`,
`CoinTipSheet`, `WhisperCard`, `Input`/`SearchField`, and `feed/`'s `FeedCard`,
`Poll` and `PhotoWhisper`.

## The rules this app follows

* **No white screens.** `#0a0814` behind everything, including the navigation
  container's own background. There is no light surface anywhere.
* **One gradient.** `#22d3ee` → `#a855f7`, left to right, on every primary
  button, with white bold text on a rounded-full shape.
* **Glass cards.** `expo-blur`, `tint="dark"`, `intensity={40}` — the value in
  `lib/theme.ts` as `GLASS.blurIntensity`, so it is one number, not forty.
* **Motion in reanimated.** Fade-in on mount, spring on press, slide-up for
  sheets.
* **The server owns the money and the paywall.** Coins are credited by
  `/api/paystack/verify`; chat unlocks, photo sends and hint unlocks are
  `spend*`/`unlock*` RPCs. The client never writes a balance.

## Things a reader will want to know

**Voice notes.** They are sent from a chat, not from the composer. `public_feed_posts`
has no audio column and the `voice-messages` bucket's storage policies are scoped
to conversations (the policy parses the conversation id out of the object's first
path segment), so a recording made in the composer would have nowhere to live.
The Chat screen records, uploads and plays them with the real waveform, and every
one is view-once.

**Photos are never shipped whole.** A photo whisper carries a ~24px blurred JPEG
in `image_preview`; the real bytes only exist after a successful claim through
`/api/feed/photo` (feed) or `/api/photos/view` (chat), which is where the
one-view rule is enforced.

**Pulling to refresh is the only way to lose an optimistic like.** Likes and poll
votes move on screen before the request resolves, and the server's count wins on
the next fetch — a refused like must not leave an inflated number behind.
