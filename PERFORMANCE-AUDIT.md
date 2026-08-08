# Whisper — Performance Audit

**Scope:** mobile responsiveness (scroll, tap latency, re-render cost, paint cost) across the app, plus the bundle and network shape of a cold load.

**A note on the numbers before anything else.** The build toolchain has been unavailable for this pass — `npx tsc --noEmit`, `npx eslint` and `npm run build` could not be run. That means **nothing below is a measured figure.** Every number in §4, §5 and §6 is a projection derived from what the change does mechanically (a removed backdrop readback, a removed style recalculation, a removed re-render), not from a Lighthouse run or a DevTools trace. They are labelled as estimates throughout and should be treated as hypotheses to confirm, not results. §1, §2, §3 and §7 are statements about the code and are verifiable by reading it.

The baseline build log at `baseline-build.log` captures a successful pre-change build (Next 16.2.9, Turbopack, 45 static routes, compile 66s) but Turbopack did not emit the per-route size table, so there is **no baseline bundle figure to diff against.** §6 is therefore reasoned, not measured.

---

## 1. Files optimized

### Rendering / re-render cost
| File | Change |
|---|---|
| [app/chat/[conversationId]/page.tsx](app/chat/[conversationId]/page.tsx) | `MessageBubble` memoized; id-valued props (`audioLoadingId`, `playingAudioId`) converted to booleans (`isAudioLoading`, `isAudioPlaying`); handlers routed through `useEventCallback` |
| [components/inbox/ChatRow.tsx](components/inbox/ChatRow.tsx) | Extracted from the inbox page and memoized as its own row component |
| [components/chat/VoiceRecorder.tsx](components/chat/VoiceRecorder.tsx) | Memoized; gesture state held in motion values so dragging never re-renders |
| [components/chat/VoicePlayer.tsx](components/chat/VoicePlayer.tsx) | Memoized; waveform resampling behind `useMemo` |
| [lib/useEventCallback.ts](lib/useEventCallback.ts) | Stable-identity callback hook, so list handlers stop invalidating memo boundaries |

### Paint / compositing cost
| File | Change |
|---|---|
| [app/globals.css](app/globals.css) | Removed the universal `* { transition-property: … transform, filter }` |
| [app/globals.css:683-688](app/globals.css#L683-L688) | `.premium-card-list-item` drops `backdrop-filter` on touch devices |
| [app/globals.css](app/globals.css) | `.chat-recording-level` given a 90ms transition so the 10Hz meter interpolates instead of strobing |
| [app/public-feed/page.tsx](app/public-feed/page.tsx) | `content-visibility` on off-screen feed cards; `loading="lazy"` + `decoding="async"` on post images |

### Network / bundle
| File | Change |
|---|---|
| [next.config.ts](next.config.ts) | `optimizePackageImports` for `lucide-react` + `framer-motion`; AVIF/WebP; 30-day image cache TTL; `removeConsole` in production; source maps off |
| [app/layout.tsx](app/layout.tsx) | Paystack's `inline.js` moved off the root layout onto `/premium` — the one route that reads `window.PaystackPop` |
| [app/layout.tsx](app/layout.tsx) | `next/font` Inter with `display: "swap"` (non-blocking) |

### Correctness fixes with a perf consequence
| File | Change |
|---|---|
| [app/layout.tsx](app/layout.tsx) | Theme-init script now reads the stored preference instead of hardcoding `"dark"` |
| [components/ThemeProvider.tsx](components/ThemeProvider.tsx) | Theme transition scoped to a `data-theme-changing` window; storage reads/writes guarded |
| [lib/useVoiceRecorder.ts](lib/useVoiceRecorder.ts) | Waveform sampled at capture via `AnalyserNode` instead of `decodeAudioData` at playback |

---

## 2. Bottlenecks fixed

**The universal transition.** `* { transition-property: …, transform, filter; duration: 250ms }` put a transition on every element in the app. Two costs: the browser tracked transition state for every node in the tree, and any Framer Motion component animating `transform` was fighting a CSS transition for the same property — motion values would be interpolated twice. Replaced with a rule scoped to `html[data-theme-changing]`, which is now actually set (it wasn't — see §2, *dead rule*).

**Backdrop-filter in scrolling lists.** `backdrop-filter` is priced per element per frame: the compositor copies the pixels behind the element, blurs them, composites the result. Twelve glass cards in a scroller is twelve readbacks, redone every frame while they move. `.premium-card-list-item` disables it under `@media (pointer: coarse)` — desktop GPUs absorb the cost and a mouse can sit still long enough to study the edge, so the effect is kept there. The visual loss is small and specific: `--theme-glass` is already ~72% opaque over a smooth gradient backdrop, so the blur had almost nothing to work on; the real loss is `saturate(180%)` on the visible quarter.

**Whole-list re-renders from id-valued props.** `MessageBubble` took `audioLoadingId` and `playingAudioId`. When one bubble started playing, both props changed value for *every* bubble, so `React.memo` compared unequal across the entire thread and re-rendered all of it. Converted to `isAudioLoading` / `isAudioPlaying` booleans, which change only for the two bubbles actually involved.

**Unstable handler identity.** Chat handlers close over pins, coins, the playing-audio id and the conversation. A plain `useCallback` would list half the component in its dependency array and change identity on nearly every render, invalidating every memoized row beneath it. `useEventCallback` gives a stable reference with fresh closure reads.

**A third-party payment SDK on all 48 routes.** Paystack's `inline.js` was mounted in the root layout. Every route fetched, parsed and executed it; exactly one route calls it. Moved to `/premium`.

**Waveform decoding at playback.** The original approach would `decodeAudioData` a finished clip to draw its envelope — hundreds of milliseconds of main-thread time, paid again by the receiver on every open. Now sampled during capture with an `AnalyserNode` at `fftSize = 32` / 10Hz and persisted to `direct_messages.audio_waveform`, so the receiver draws the sender's actual envelope for free.

**A 10Hz meter strobing.** The live recording meter updates 10×/sec; at 28 bars that's a visible flicker as heights snap. A 90ms linear height transition interpolates between samples, below the perception threshold for stepped motion.

**Gesture state in React state.** The record-button drag runs entirely on `useMotionValue` / `useTransform`. Only the timer and the live meter re-render; the drag itself does not.

**Dead rule: the theme transition never fired.** `html[data-theme-changing]` was written in CSS but no code ever set the attribute, so theme switches snapped instead of easing. Now set by `applyTheme()` for a 320ms window — and deliberately *skipped* on the initial apply, where there is nothing to cross-fade from.

**Flash of wrong theme on every load.** `app/layout.tsx`'s pre-paint script hardcoded `const resolved = "dark"`, ignoring the stored preference. Every light-theme user painted dark and then repainted light after hydration. The script now reads `localStorage` before first paint. Related: `ThemeProvider` only consulted storage for *signed-in* users, so a logged-out user's choice was applied at paint and then discarded — it now seeds from storage and lets the account preference override.

---

## 3. Remaining bottlenecks

Ordered by expected impact.

1. **No `LazyMotion` anywhere.** 28 `.tsx` files import from `framer-motion` directly, so every one pulls the full feature bundle. `LazyMotion` + `domAnimation` with `m.*` components instead of `motion.*` is the standard fix and is worth the most of anything left on this list. `optimizePackageImports` helps the import graph but does not shrink the feature set that ships.

2. **No route-level code splitting.** `next/dynamic` appears in zero files. Heavy, conditionally-rendered surfaces (the emoji picker, the media viewer, the pin sheet, the attach sheet) are in the initial chunk of their route regardless of whether they open.

3. **No list virtualization.** Chat and inbox render every row. Long threads mount hundreds of DOM nodes. The memoization above makes re-renders cheap but does not reduce node count, and node count is what costs on a low-end Android device.

4. **Scroll-linked `filter: blur(0 → 12px)` in [components/Hero.tsx](components/Hero.tsx).** Animating `filter` forces a re-rasterization every frame — it is not a compositor-only property. This is left in place deliberately: it is a design decision, and it is on the marketing home page rather than a hot app surface. Flagged rather than changed.

5. **Remaining full-strength `backdrop-filter` sites.** Nine surfaces still run `blur(20-40px) saturate(160-180%)` (globals.css lines 595, 736, 1106, 1404, 1451, 1867, 2188, 2271). Most are single fixed elements — nav, sheets, modals — where the cost is one readback, which is fine. The one worth measuring is any that ends up inside a scrolling container.

6. **Raw `<img>` without hints.** `loading="lazy"` / `decoding="async"` are set in the public feed and two components; other avatar and media sites still use bare `<img>`. Each is a small main-thread decode on the critical path.

7. **Two `react-hooks/set-state-in-effect` lint errors** in the chat page. Pre-existing, untouched this pass. They indicate a render→effect→render cascade worth unwinding.

8. **Dead dependency: `react-hot-toast`** is installed and never imported — the custom `ToastProvider` is what's wired. It is tree-shaken out of the client bundle but still costs install and audit surface.

---

## 4. Expected Lighthouse movement — *estimates, unverified*

| Metric | Direction | Reasoning |
|---|---|---|
| **Total Blocking Time** | Largest gain | Paystack's SDK leaving 47 of 48 routes removes a third-party parse+execute from every cold load. This is the single clearest TBT win available. |
| **First Contentful Paint** | Modest gain | `display: "swap"` was already correct; the gain is the removed script from the head of the load. |
| **Cumulative Layout Shift** | Gain on light-theme loads | The theme flash was a full-page repaint after hydration. It did not shift *layout*, so CLS proper may not move much — but the perceived stability gain is real and is what users report as "cheap-feeling". |
| **Largest Contentful Paint** | Small gain | AVIF/WebP plus the 30-day cache TTL; mostly a repeat-visit and cellular win rather than a cold-lab-run one. |
| **Total bytes** | Gain, size unknown | See §6. |

Honest expectation: **TBT is where a Lighthouse run should visibly move.** FCP/LCP changes will be modest because the app was not blocked on fonts or render-blocking CSS to begin with. Anyone claiming a specific score delta here without running it is guessing.

---

## 5. Estimated FPS movement — *estimates, unverified*

The scroll surfaces most likely to have been dropping frames on mid-range Android are the **public feed** and the **inbox**, both for the same reason: N glass cards × one backdrop readback each × every frame.

- **Public feed / inbox scroll:** the largest expected gain, because removing per-card `backdrop-filter` removes work that scaled with the number of visible cards. On a device that was dropping frames, this is the change most likely to restore a held 60fps. Magnitude depends entirely on the GPU and card count — a device that was already holding 60 sees nothing.
- **Chat thread scroll:** the memo fixes stop whole-thread re-renders on audio play/pause. This helps *interaction* responsiveness during playback more than it helps steady-state scrolling, since scrolling did not re-render bubbles anyway.
- **App-wide style recalculation:** removing the universal transition reduces recalculation work on every style change. Small per event, paid constantly.
- **Recording gesture:** should be solidly 60fps — the drag is motion-value-driven and never re-renders React.

**What to actually measure:** DevTools Performance, mobile emulation with 4× CPU throttle, scroll the public feed. Compare frames and the "Recalculate Style" / "Composite Layers" bands before and after. That trace is the only thing that turns the above into fact.

---

## 6. Bundle reduction — *reasoned, not measured*

No baseline exists to diff against (see the preamble), so this section states *what was removed* rather than *how many kilobytes*.

**Removed from the initial load of 47 routes:** Paystack `inline.js`, a third-party payment SDK, fetched and executed on every route that isn't `/premium`. This is a network request plus parse plus execute, and it is the largest single item removed.

**Removed from production builds:** all `console.log` / `.debug` / `.info` call sites (`removeConsole`, keeping `error` and `warn`). On mobile these are not free — each call serializes its arguments whether or not devtools is attached.

**Removed from deployment:** production browser source maps.

**Import graph narrowed:** `optimizePackageImports` rewrites `lucide-react` and `framer-motion` barrel imports to deep imports at build time. `lucide-react` is the meaningful one — a several-thousand-module icon set imported in ~40 files.

**Image payload:** AVIF-first with WebP fallback, typically 20-30% under WebP at matched quality, plus a 30-day `minimumCacheTTL` so content-addressed storage objects and deterministic generated avatars stop being re-fetched over cellular.

**Still on the table, unclaimed:** `LazyMotion` (§3.1) and `next/dynamic` splitting (§3.2) are both real reductions that have *not* been made. They are likely larger than anything listed above.

To establish a baseline for future passes: run `npm run build` and capture the per-route table before the next change set.

---

## 7. Components still needing optimization

| Component / file | What it needs | Why it's not done |
|---|---|---|
| **The 28 `framer-motion` importers** | `LazyMotion` + `domAnimation`, `motion.*` → `m.*` | Mechanical but wide; wants a build to verify nothing regressed |
| [app/notifications/page.tsx](app/notifications/page.tsx) | Memoized row component, same treatment as `ChatRow` | **Not touched — awaiting your go-ahead.** You previously stopped a read of this file |
| [app/profile/page.tsx](app/profile/page.tsx) | `.premium-card-list-item` on its scrolling card list | Straightforward; not yet applied |
| [app/activity-log/page.tsx](app/activity-log/page.tsx) | Same | Same |
| [app/saved-messages/page.tsx](app/saved-messages/page.tsx) | Same | Same |
| [app/chat/[conversationId]/page.tsx](app/chat/[conversationId]/page.tsx) | Virtualization; unwind the 2 `set-state-in-effect` errors; `next/dynamic` for the emoji picker and media viewer | Virtualization is invasive on a file with live subscriptions, presence and typing — wants its own pass |
| [app/inbox/page.tsx](app/inbox/page.tsx) | Virtualization once row count justifies it | Rows are memoized; node count is the remaining cost |
| [components/Hero.tsx](components/Hero.tsx) | Scroll-linked `filter: blur()` → a pre-blurred layer cross-faded on opacity | Deliberately left: your design decision, and it's on the marketing page |
| `StatsCard`, `ProfileCard`, `AnalyticsCard` | Delete — all three are unreferenced | Dead code; removal is trivial but out of this pass's scope |
| `react-hot-toast` | Uninstall | Unused dependency |

---

## Verification still outstanding

None of this has been compiled. Before trusting any of it:

```
npx tsc --noEmit
npx eslint app components lib          # note: `next lint --file` does not exist in Next 16
npm run build
```

Two known pre-existing lint failures will appear in the chat page (`react-hooks/set-state-in-effect`); they predate this work and were left alone.

**Also outstanding and blocking, unrelated to performance:** `supabase/migrations/202608070001_voice_notes_and_pins.sql` has not been applied. Until it is, voice notes and pinned messages do not function at all — the client code is complete but the tables, policies, storage bucket and RPCs it calls do not exist yet.
