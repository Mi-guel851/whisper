# Web ↔ Native Rematch — final report

Branch `arena/01a09583-whisper`, tip `77dfc67`, PR #63. Web app = source of truth.
`tsc` 0 errors · 0 TODOs · 51 web pages vs 31 native routes, every user-facing page mapped.

## The full page map

| Web | Native | Status |
|---|---|---|
| `/` landing | `(auth)/onboarding.tsx` | **Rebuilt this round** — the real hero (below) |
| `/login` | `(auth)/login.tsx` | ✅ copy aligned ("Login to your Whisper account", "Don't have an account? Sign Up") |
| `/signup` | `(auth)/signup.tsx` | ✅ "Create Account", terms sentence + Privacy/Terms links, "Already have an account? Login" |
| `/forgot-password` | `forgot-password.tsx` | ✅ recovery phrase → `/api/reset-with-phrase` |
| `/complete-profile` | `complete-profile.tsx` | ✅ username, country+phone, consent, recovery phrase |
| `/dashboard` | `(tabs)` shell | ✅ **+ the "Before you whisper…" popup, once per session (below)** |
| `/public-feed` | `(tabs)/feed.tsx` | ✅ four sorts, topics, search, threads, Daily Whisper, creator badge, polls |
| `/inbox` | `(tabs)/dms.tsx` + `(tabs)/notifications.tsx` | ✅ presence dots live (bug fixed, below) |
| `/chat/[id]` | `conversation.tsx` | ✅ voice notes, view-once, receipts, pins, 40-coin gate |
| `/call/[id]` | in-app call overlays | ✅ by design — calls are overlays, not a page |
| `/friends` | `friends.tsx` | ✅ **rebuilt to 4 tabs: Discover · Active · Requests · Friends, anonymous names (below)** |
| `/active` (redirect) | → Friends "Active" tab | ✅ now exists |
| `/discover` | `discover.tsx` | ✅ |
| `/profile`, `/settings`, `/appearance` | `(tabs)/profile.tsx`, `settings.tsx` | ✅ wallet / notifications / feel / appearance / account / about; "Settings" title matches |
| `/u/[username]` | `u.tsx` | ✅ |
| `/saved-posts` (+`/saved-messages` redirect) | `saved.tsx` | ✅ |
| `/favorites` | `favorites.tsx` | ✅ |
| `/pinned-messages`, `/blocklist` | — | ✅ web pages literally say "This feature is coming soon." and nothing links to them — parity is having no page |
| `/banned` | `banned.tsx` + root `BanGate` | ✅ **added this round** |
| `/creator` (+`/official` redirect) | `creator.tsx` | ✅ |
| `/premium` | `coins.tsx` | ✅ Paystack store, kobo, verify, cancel toast |
| `/games`, `/help-center`, `/contact-support`, `/feedback` | `games.tsx`, `help.tsx`, `support.tsx`, `feedback.tsx` | ✅ |
| `/privacy`, `/terms`, `/community-guidelines` | `legal.tsx` (slug routes) | ✅ |
| `/choose-platform` | — | deliberate: you're *in* the app already; "Create My Link" goes straight to signup |
| `/admin/*` (10 pages), `/setup`, `/activity-log`, `/analytics`, `/blocked-keywords` | `admin.tsx` | ✅ announcements admin (PIN-gated, hidden from non-admins) — moderation intentionally web-only |
| `/picker-test` | — | dev tool, correctly skipped |

## What was built this round

**1. The landing hero (`(auth)/onboarding.tsx`)** — was still the old "Say it. Anonymously." intro; now it is the web's Hero, section for section:
- Navbar row: **Whisper** wordmark, ghost **Login**, premium-gradient **Start** pill.
- Eyebrow pill with the **pulsing cyan dot**: "100% Anonymous. Always."
- Headline "Honest conversations start with **Whisper.**" entering word by word (0.66s, expo-out, 75ms stagger, y+fade) with a **travelling 6-stop gradient sweep** on "Whisper." — the native translation of the web's animated `background-position`, done with a masked gradient that slides under the text.
- Web sub copy verbatim. **Create My Link** (purple→pink, ArrowRight) → signup · **See how it works** (Play) scrolls to the four-step strip (web STEPS copy: create your link → share it anywhere → receive messages → reply and react).
- Social proof: the web's three seeds (@its_joycee, @real_kayz, @mimi.vibes) as overlapping generated avatars using the web's own hash→hue-ramp algorithm + a **120,000+ count-up**.
- Closing gradient CTA. First launch lands here; after that the app opens on login (the index fork now checks `isOnboarded`).

**2. "Before you whisper…" (`components/TermsModal.tsx`)** — mounted on the tabs shell, **once per session**, copy-for-copy: ghost mark, the three agreements (Be kind / No harassment, threats, hate speech… / Not for scandals, rumors…), "I Agree — Let's Whisper" (loading state), "Violating these guidelines may result in account suspension." Accepting writes `profiles.terms_accepted = true` — same write, same copy, same cadence as the web dashboard.

**3. Bans (`lib/bans.ts` + `components/BanGate.tsx` + `app/banned.tsx`)** — polls `my_ban_status` every 60s; a banned account is replaced onto the ban screen from any route (the web BanGate contract). The screen carries the reason, "Your ban expires on …" or "This restriction is permanent.", Contact Support (opens the site's support page), sign out — plus the web's unbanned branch ("Your account is active" / Re-check now).

**4. Friends parity** — four tabs in the web's order; an **Active** tab (everyone online but you, Message / disabled "Requested" / Add Friend, "No one else is online" empty state); **anonymous names on every row** via the same identity map the web uses (real display names were leaking before — the web never shows them here); web subtitles ("Active now", "Friend", "Wants to be friends", "Request pending", "Anonymous Whisper user") and the web's empty-state copy.

**5. Fixes found by the rematch** — the DM presence effect was nested inside the load effect body (an Invalid-hook-call crash waiting to happen) — lifted to top level; login/signup copy aligned to the web's exact strings.

## Deliberate adaptations (web-only by nature)
- Phone mockup / orbit chips, testimonials, stats strip, footer marketing bulk, "Download the Android app" lockup — desktop-landing furniture; the phone shows pitch + proof + doors.
- Calls are in-app overlays, not a `/call` page. `/choose-platform` is meaningless inside the app.

---

# What YOU need to do to make the app function like the site

The app is code-complete; everything below is **your infrastructure**, the same pieces the website already runs. Do these once:

### 1. Create `whisper-native/.env` (copy the values from your **deployed site's** environment)
```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co      # same project the site uses
EXPO_PUBLIC_ANON_KEY=eyJ...                                      # same anon key (Settings → API in Supabase)
EXPO_PUBLIC_API_BASE_URL=https://whisper-anonymous.vercel.app    # your deployed site (Paystack verify, creator posts, reset-with-phrase)
EXPO_PUBLIC_SITE_URL=https://whisper-anonymous.vercel.app        # legal links + support links open this
EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY=pk_live_...                      # the SAME live key the site uses
EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME=<your cloud name>
EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET=<your unsigned preset>      # the one the site already uses
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=226343458064-tq6nf31ekoos2h6r7dk4dc1o1cobaoh5.apps.googleusercontent.com
EXPO_PUBLIC_SIGNUPS_OPEN=true                                    # or false to close signup like the site's gate
EXPO_PUBLIC_ADMIN_EMAILS=mfonisobassey851@gmail.com,basseyaniekeme43@gmail.com
```
No Supabase work is needed — **no new tables, policies, or functions**: every RPC the app calls (`my_ban_status`, announcements, creator, polls, presence, votes) is already live on the project the website runs on.

### 2. Turn on Google sign-in for Android/iOS (10 min, in Google Cloud Console)
- The **Web client** ID above must exist with its secret pasted into **Supabase → Auth → Providers → Google** (if the site's Google login works, this is already done ✅).
- Add an **Android OAuth client**: package name `com.whisper.app`, SHA-1 = your signing keystore's (`cd android && ./gradlew signingReport`, or `keytool -list -v -keystore your.keystore`). Without this the native picker returns the ID token but Supabase rejects it.
- iOS uses the `iosUrlScheme` already set in `app.json` (reverse client ID) — add an iOS client in Google Console if you ship iOS.

### 3. Build a real dev build — **Expo Go will NOT work**
Voice calls (WebRTC), push notifications, and the native Google picker all need native modules:
```
cd whisper-native
npm install
npx expo prebuild          # generates android/ (and ios/); app.json already has the scheme + url scheme
npx expo run:android       # or: npx expo run:ios
```
After the first build, `npx expo start` and press `a` / `i` is fine (Metro rebundles JS into the installed app).

### 4. Push notifications (FCM)
- Put **your** `google-services.json` (Firebase console → project settings → Android app, package `com.whisper.app`) at `whisper-native/android/app/google-services.json`.
- iOS push needs an APNs key uploaded to Firebase (only when you ship iOS).
- The app registers tokens via the existing `register_device_token` RPC on your Supabase project — nothing to configure there.

### 5. Money (coins)
- With the live Paystack key in `.env` the store charges real naira. Test first with a **test** key (`pk_test_…`) and Paystack test cards; the app verifies through your site's `/api/paystack/verify`, so `EXPO_PUBLIC_API_BASE_URL` must point at the **deployed site**.

### 6. Admin
- Keep both admin emails in `EXPO_PUBLIC_ADMIN_EMAILS` (or rely on the defaults). The admin surface appears on the Profile screen only for those emails, and opens with the **same PIN the site's admin uses** (`x-admin-pin`).

### 7. Email links (only if you use email OTP flows)
- Supabase → Auth → URL configuration: add `https://whisper-anonymous.vercel.app/**` and `whisper://**` as redirect targets so confirmation links land correctly on web and app.

### Then run it
```
cd whisper-native && npm install && npx expo prebuild && npx expo run:android
```
Sign up → the "Before you whisper…" popup appears once → you're on the feed — the same account, same data, same coins as the website, because it's all one Supabase project.
