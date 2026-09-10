# Whisper — UI fixes and security follow-up

**Date:** 10 September 2026  
**Status:** Implemented in the working branch. **Not deployed. Two database migrations require application and verification.**

## Executive summary

- Opaque, elevated popup and header surfaces now share the same rules in dark and light modes.
- Inbox long-press actions render outside clipping containers, with a shadow, a dimmed backdrop, viewport clamping and keyboard dismissal/navigation.
- Public-feed replies expand **one branch at a time**, rather than automatically exposing every descendant.
- Dashboard edge lighting is restored on hover and keyboard focus; touch devices retain a quiet static rim, and reduced-motion preferences are respected.
- Dependency audit: **18 advisory-affected packages before → 0 after**, including development dependencies. This is an advisory scan result, **not a guarantee against vulnerabilities**.
- A critical client-callable coin refund function was found. Its replacement is server-only, and a migration revokes the old client permissions.
- Payment ownership, view-once concurrency, server-side URL fetching, private-column grants and rate-limit handling have been hardened.

## 1. Visible changes

### Opaque overlays and scrolling headers

`app/globals.css` now gives the shared glass/chrome tokens an opaque surface in both themes. Gradients and borders can still provide depth, but text beneath an open panel no longer supplies its background.

The shared `Modal` explicitly uses `--theme-surface-solid`, keeps its elevation shadow, and supports scrolling within a viewport-bounded panel. Menus, listboxes, tooltips, drawers and chat chrome receive a solid surface and elevation. Dashboard/feed sticky chrome is opaque, so scrolled content does not show through it. Scrims intentionally remain semi-transparent; the **content panels** do not.

`components/inbox/InboxChatMenu.tsx` now:
- portals to `document.body`, avoiding ancestor transforms and clipping;
- clamps its horizontal position and flips near the bottom;
- dims the page behind it;
- closes on outside press, scroll, resize, Escape or selection;
- supports arrow/Home/End keys, initial focus and focus restoration;
- uses minimum 44px action targets.

### Public-feed reply nesting

`FeedPostCard` no longer passes an inherited `threadOpen` flag to descendants. Each post/reply reads its own expansion state. Opening a root displays its immediate replies; a reply's children remain hidden until that reply's icon is selected. Counts stay beside the reply icon. Root counts represent the conversation total; loaded nested-reply counts represent direct children.

Shared links to a nested reply reveal only its ancestor path. Indentation is capped to keep deeper conversations readable on a narrow phone. Independent hide controls remain available.

### Dashboard finish

The compact layout from the previous pass remains. Edge-lit cards now brighten and animate their rims on pointer hover or keyboard focus, rather than running many bright animations continuously. Touch has a static rim; reduced-motion disables the sweep.

## 2. Security findings and implemented fixes

| Severity | Finding | Change | Deployment status |
|---|---|---|---|
| **Critical** | `refund_whisper_coins` was executable by authenticated clients and credited an arbitrary positive amount without proving a preceding debit. | New migration revokes client access to all overloads of refund/purchase/payment-credit functions. Failed-post refunds now call a service-role-only `refund_whisper_coins_for` using the verified caller's ID. | **Migration required. Not closed in production until applied.** |
| **High** | Payment verification used the shared billing email and transaction validity, but did not bind redemption to the purchasing account. | Verification checks the gateway-returned reference and `metadata.user_id`. Older checkouts are accepted only when their immutable gateway reference contains the same user ID and coin package. New checkouts include owner metadata. | Code ready; gateway test required. |
| **High** | Existing hint-column revocation was not a reliable boundary in the presence of table-level SELECT grants. Recovery hashes also had no explicit private-column protection in the supplied migrations. | New grant-repair migration replaces broad client grants with non-secret column grants, preserving existing effective client access and RLS. Protects hint/identity reads and recovery-hash reads/writes. ProfileCard no longer selects `*`. | **Migration required; actual pre-existing production grants were not visible.** |
| **Medium** | Concurrent chat photo/audio requests could both download media and return it after unconditional updates; update failures were ignored. | Conditional atomic UPDATE requires an unspent timestamp and unchanged path, returns a claimed row, and denies the loser or an update error before sending bytes. | Code ready; live concurrent-request test required. |
| **High, conditional on attacker-controlled subscriptions** | Push subscriptions supplied destination URLs to a privileged server sender. | HTTPS push-service host allowlist; rejects credentials, alternate ports, IP/internal destinations and lookalike hosts. Adds delivery timeout and explicit missing-secret refusal. | Code ready; supported-browser push tests required. |
| **Medium / defense in depth** | Image fetches followed redirects and buffered arbitrarily sized responses. | Cloudinary cloud/host validation tightened; redirects disabled; deadlines added; streaming response capped at 16 MiB; raster image MIME allowlist rejects HTML/SVG. | Code ready. |
| **Medium** | Limiter cleanup discarded buckets after ten minutes even for fifteen-minute windows, and could grow without a hard bound. | Per-bucket expiry preserved. At capacity, new identities fail closed rather than evicting active limits. | Code ready; still per-instance. |
| **Low / defense in depth** | Stored recovery-hash parameters could request excessive PBKDF2 work; native callbacks logged complete URLs. | Bounds on iterations/key length/salt; removed callback URL logging that could include tokens. | Code ready. |
| **Critical/high advisories** | Framework/image/tooling packages had published advisories. | Next and eslint-config-next upgraded to 16.3.4; lockfile refreshed. Scoped asset-tool overrides upgrade Sharp, tar and Xcode's UUID dependency. | Build and tooling smoke checks passed. Native builds still required. |

### Dependency evidence

Before: **2 critical, 12 high, 4 moderate** advisory-affected packages.  
After clean install: **0 critical, 0 high, 0 moderate, 0 low** reported by `npm audit`. The production-only audit also reported zero.

The overrides are intentionally scoped to old transitive tooling dependencies, rather than replacing the asset generator or forcing an app-wide major upgrade. Remove/revisit them when upstream ships compatible patched dependencies. They were smoke-tested, not validated with full Android/iOS release builds.

## 3. Review coverage and limits

This was a repository review, not a live penetration test. Work included:
- inventory and authorization-pattern checks across **31 API route files**;
- focused inspection of payment, refund, recovery, admin authorization, media delivery, webhook/push, AI limiting and Cloudinary paths;
- examination of relevant database grants/RPCs and the previous audit;
- native configuration and callback-log review;
- current tracked-file secret-pattern and dangerous-code-sink searches;
- dependency advisory checks, TypeScript, lint, production build and regression tests.

Secret-pattern matches were public Firebase client configuration and literal PEM parsing markers, not confirmed embedded server private keys. This was **not a full-history secret scan**. Firebase client keys still require provider-side API/application restrictions.

No production Supabase grants, deployed migration state, Vercel WAF rules, Cloudinary settings, payment dashboard, native signing setup or production secrets were available for verification. The base schema and the payment-credit implementation are not fully represented in this repository. These limits prevent an honest claim that every vulnerability has been eliminated.

## 4. Required release steps

1. Back up the database and test the changes in staging.
2. Apply `supabase/migrations/202609100001_refund_authorization.sql` **before enabling the updated posting endpoints**. It closes the client refund hole and installs the server replacement. Coordinate deployment/maintenance: the old API cannot use the revoked refund function during the gap.
3. Deploy the explicit ProfileCard projection and apply `supabase/migrations/202609100002_private_column_grants.sql` in the same maintenance window. Old `select('*')` clients may be denied rather than receiving private fields; force a refresh/update where needed.
4. Verify as `anon` and as a regular authenticated user:
   - old refund/purchase/payment-credit functions and the new server refund function are not executable;
   - recovery hashes and protected message identity/hint columns cannot be selected directly;
   - recovery hashes cannot be inserted/updated directly;
   - normal profile edits, anonymous message sending, paid hint retrieval and recovery flows still work.
5. Verify service-role refunds after a deliberately failed post, and verify a successful post is charged only once.
6. Test Paystack in test mode: correct owner succeeds; a different account cannot claim the same reference; duplicate verification does not double-credit. **Reference uniqueness/idempotency inside the deployed `credit_verified_payment` function must be checked.**
7. Fire two simultaneous view-once requests; only one should receive media. Also test storage failures and lost network responses.
8. Test inbox long-press, modal scrolling, dark/light scrolling headers and feed nesting on Android, iOS and desktop; rebuild native releases.

## 5. Remaining risks — do not treat these as fixed

- **Deployment is part of the fix.** Database vulnerabilities remain reachable until the migrations are applied. The SQL is reviewed and source-guarded but was not executed against a live PostgreSQL instance here.
- **Distributed abuse protection:** API/recovery/admin counters are still primarily per-instance. Configure durable rate limits or WAF rules, especially on recovery and privileged auth endpoints. The AI path already has a durable limiter, but that does not cover all routes.
- **View-once privacy is not DRM:** chat rows currently carry media paths and the app uses public Cloudinary delivery URLs. A recipient may preserve a URL or bytes before the application marks a view as spent. Conditional claims stop duplicate responses through these endpoints, not copying through every possible path. Stronger guarantees require private media storage, server-only path access, verified storage/RLS rules and careful CDN handling. Even that cannot prevent screenshots/recording.
- **Upload abuse:** the unsigned Cloudinary preset needs provider-enforced size/type/folder restrictions, quotas and monitoring. Browser-side checks are not authorization. Consider authenticated signed uploads for stronger ownership controls.
- **Recovery/session security:** verify session and refresh-token revocation after password reset; require strong recovery phrases; use MFA for privileged accounts. This pass removed token URL logging but did not replace native implicit token callbacks with a complete PKCE/state flow.
- **Database/API boundaries:** verify base-table RLS, private storage policies, definer RPC grants and payment idempotency against the deployed schema. Do not assume the earlier audit's claimed deployment status.
- **Browser policy:** existing anti-framing/nosniff restrictions remain. A strict nonce-based script CSP still needs a staged compatibility rollout for Next, Paystack and native/auth flows.
- **Known-advisory-free is not vulnerability-free.** Continue dependency monitoring and independent security testing.

## 6. Validation results

| Check | Result |
|---|---|
| Clean `npm ci --ignore-scripts` | Passed |
| `npm audit` including dev packages | Zero reported vulnerabilities |
| Production-only dependency audit | Zero reported vulnerabilities |
| `npx tsc --noEmit` | Passed |
| `npm run build` on Next 16.3.4 | Passed; framework warns about the existing Edge runtime |
| Whole-repository lint | 0 errors, 27 warnings (image usage/hooks/unused variables) |
| Existing tests and dashboard guards | Passed |
| New security tests | Passed: ownership/legacy reference, SSRF destinations, stream bounds, limiter expiry/capacity and SQL/API source guards |
| Actual FeedPostCard rendering tests | Passed: independent nested expansion, sibling isolation, counts, parent collapse and composer isolation |
| Patched tooling smoke checks | Asset CLI starts; Sharp pipeline and Xcode parsing/UUID generation pass |
| Browser automation | Not completed: Chromium download was blocked by a network/TLS connection failure; certificate checking was not disabled |
| Live DB, payment, push and native release tests | Not run; required before production sign-off |

All changes are saved on the session branch. No deployment, database mutation, commit or push was performed.
