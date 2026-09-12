/**
 * Paid at the gateway, credited to the wallet — executed, not inspected.
 *
 * The bug this file exists for: a payment confirmed by Paystack whose coins
 * never appeared. The old design had exactly one credit path — the Paystack
 * iframe's callback in the browser calling /api/paystack/verify — so a lost
 * round trip (app closed right after the success screen, network blip at
 * hangover, transfer still settling as "pending") paid money that never
 * became coins. The fix has three parts, and this file runs all of them:
 *
 *   1. the IPN webhook — /api/paystack/webhook credits a gateway-confirmed
 *      transaction with no browser at all, under HMAC verification;
 *   2. the shared settlement chain — verify and webhook run the SAME rules
 *      (ownership, currency, package, amount, email) and land on the same
 *      idempotent credit, so whichever path arrives first wins and the rest
 *      are no-ops;
 *   3. the page's pending-payment reconciliation — the source-level
 *      contract that a started-but-unsettled payment gets re-verified.
 *
 * The Supabase double mirrors credit_verified_payment's replay semantics
 * exactly (a reference credits once; replays return the balance), so the
 * "no double credit" assertions test the real behaviour.
 *
 * Run: node tests/payments.test.mjs
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFile } from "node:fs/promises";

register("./payment/hooks.mjs", import.meta.url);

process.env.PAYSTACK_WEBHOOK_SECRET = "test-webhook-secret";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.PAYSTACK_SECRET_KEY = "sk_test";

const { state, reset, seedUser } = await import("./payment/stubs/supabase.mjs");
const { paystackSignature } = await import("@/lib/paystack/signature");
const { POST: webhookPost } = await import("@/app/api/paystack/webhook/route");
const { POST: verifyPost } = await import("@/app/api/paystack/verify/route");

const OWNER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MASKED = "whisper.anonymous.app@gmail.com";

let failures = 0;
function ok(name, check) {
  assert.ok(check, name);
  console.log(`  ok   ${name}`);
}

function post(handler, body, headers = {}) {
  const request = new Request("http://localhost/api/paystack", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
  return handler(request);
}

/** A charge.success IPN body for the 300-pack (₦3,000 = 300,000 kobo). */
function ipnSuccess({ reference = "whisper_ref_001", coins = "300", amount = 300000, region = "ngn", userId = OWNER, email = MASKED } = {}) {
  const body = JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      amount,
      currency: "NGN",
      status: "success",
      metadata: { coins, region, ...(userId ? { user_id: userId } : {}) },
      customer: { email },
    },
  });
  return { body, signature: paystackSignature(body, process.env.PAYSTACK_WEBHOOK_SECRET) };
}

/* --------------------------------------------------------------------- */
console.log("1. the webhook is locked down");
/* --------------------------------------------------------------------- */

reset();
{
  /* A charge with no recoverable owner: the signature layer is exercised in
     isolation — a valid signature still lands on a policy skip, and a bad
     one is refused before the body is even parsed. */
  const { body, signature } = ipnSuccess({ reference: "whisper_ref_001", userId: null });

  const well = await post(webhookPost, body, { "x-paystack-signature": signature });
  const wellData = await well.json();
  ok("a signed, well-formed event is processed", well.status === 200 && wellData.credited === false);

  const bad = await post(webhookPost, body, { "x-paystack-signature": "deadbeef".repeat(16) });
  ok("a forged signature is refused before anything else", bad.status === 401);
  ok("…and nothing was credited", state.credits.length === 0);

  const none = await post(webhookPost, body, {});
  ok("a missing signature is refused", none.status === 401);

  const tampered = await post(webhookPost, body.slice(0, -2) + "}", { "x-paystack-signature": signature });
  ok("a signature over a different body is refused", tampered.status === 401);
}

/* --------------------------------------------------------------------- */
console.log("2. a confirmed charge becomes coins, once, no browser required");
/* --------------------------------------------------------------------- */

reset();
seedUser("token-owner", OWNER, 5);
{
  const { body, signature } = ipnSuccess({ reference: "whisper_ref_002" });

  const res = await post(webhookPost, body, { "x-paystack-signature": signature });
  const data = await res.json();
  ok("the webhook answers success", res.status === 200 && data.credited === true);
  ok("the wallet moved by exactly the package", state.wallets.get(OWNER) === 305);
  ok("one ledger credit, with the gateway's numbers", state.credits.length === 1
    && state.credits[0].coin_amount === 300
    && state.credits[0].payment_reference === "whisper_ref_002"
    && state.credits[0].amount_minor_units === 300000);

  /* The same event arrives again — Paystack retries, or the browser's own
     verify raced the IPN. The replay guard makes it a no-op. */
  const replay = await post(webhookPost, body, { "x-paystack-signature": signature });
  await replay.json();
  ok("a replayed event does not credit twice", state.wallets.get(OWNER) === 305 && state.credits.length === 1);
}

/* --------------------------------------------------------------------- */
console.log("3. a confirmed charge that is not ours does not become coins");
/* --------------------------------------------------------------------- */

reset();
seedUser("token-owner", OWNER, 0);
{
  /* Tampered amount: the 300-pack charged as ₦2,999.99. */
  const amount = ipnSuccess({ reference: "whisper_ref_003", amount: 299999 });
  const r1 = await post(webhookPost, amount.body, { "x-paystack-signature": amount.signature });
  const d1 = await r1.json();
  ok("a tampered amount is acked but not credited", r1.status === 200 && d1.credited === false);
  ok("…and the wallet never moved", state.wallets.get(OWNER) === 0 && state.credits.length === 0);

  /* No owner anywhere: no metadata user_id, no legacy reference shape. */
  const orphan = ipnSuccess({ reference: "somebody-elses-charge", userId: null });
  const r2 = await post(webhookPost, orphan.body, { "x-paystack-signature": orphan.signature });
  const d2 = await r2.json();
  ok("a charge with no recoverable owner is acked but not credited", r2.status === 200 && d2.credited === false);

  /* The owner's own metadata cannot be used to credit a different user's
     wallet: the gateway's transaction must match the expected owner. */
  const crossed = ipnSuccess({ reference: "whisper_ref_004", userId: OTHER });
  const r3 = await post(webhookPost, crossed.body, { "x-paystack-signature": crossed.signature });
  const d3 = await r3.json();
  ok("a charge owned by another account credits that account, not this one", r3.status === 200 && d3.credited === true);
  ok("…to the owner the metadata names", state.wallets.get(OTHER) === 300 && state.wallets.get(OWNER) === 0);

  /* Not settled yet: nothing moves, and the event is acked, not retried. */
  const creditsBefore = state.credits.length;
  const pendingBody = JSON.stringify({
    event: "charge.success",
    data: { reference: "whisper_ref_005", amount: 300000, currency: "NGN", status: "pending", metadata: { coins: "300", region: "ngn", user_id: OWNER }, customer: { email: MASKED } },
  });
  const r4 = await post(webhookPost, pendingBody, { "x-paystack-signature": paystackSignature(pendingBody, process.env.PAYSTACK_WEBHOOK_SECRET) });
  const d4 = await r4.json();
  ok("a still-pending transaction is acked without credit", r4.status === 200 && d4.credited === false && state.credits.length === creditsBefore);

  /* Legacy checkouts encode the owner in the reference itself. */
  const legacyBody = JSON.stringify({
    event: "charge.success",
    data: {
      reference: `whisper_${OWNER}_100_1700000000000`,
      amount: 100000,
      currency: "NGN",
      status: "success",
      metadata: { coins: "100", region: "ngn" },
      customer: { email: MASKED },
    },
  });
  const r5 = await post(webhookPost, legacyBody, { "x-paystack-signature": paystackSignature(legacyBody, process.env.PAYSTACK_WEBHOOK_SECRET) });
  await r5.json();
  ok("a legacy reference still redeems to the user it encodes", state.wallets.get(OWNER) === 100);
}

/* --------------------------------------------------------------------- */
console.log("4. the browser path (verify) credits, and says 'pending' honestly");
/* --------------------------------------------------------------------- */

reset();
seedUser("token-owner", OWNER, 0);
let paystackReply = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify(paystackReply), { status: 200 });
try {
  const auth = { Authorization: "Bearer token-owner" };

  const successTx = { status: "success", data: { reference: "whisper_ref_010", amount: 300000, currency: "NGN", status: "success", metadata: { coins: "300", region: "ngn", user_id: OWNER }, customer: { email: MASKED } } };
  paystackReply = successTx;
  const r1 = await post(verifyPost, { reference: "whisper_ref_010" }, auth);
  const d1 = await r1.json();
  ok("a verified success credits the wallet", r1.status === 200 && d1.success === true && d1.balance === 300 && state.wallets.get(OWNER) === 300);

  /* The IPN for the SAME payment then arrives: the reference guard means
     the second path is a free no-op, not a double credit. */
  const ipn = ipnSuccess({ reference: "whisper_ref_010" });
  await post(webhookPost, ipn.body, { "x-paystack-signature": ipn.signature });
  ok("verify and webhook racing the same payment credit exactly once", state.wallets.get(OWNER) === 300 && state.credits.length === 1);

  const pendingTx = { status: "success", data: { reference: "whisper_ref_011", amount: 300000, currency: "NGN", status: "pending", metadata: { coins: "300", region: "ngn", user_id: OWNER }, customer: { email: MASKED } } };
  paystackReply = pendingTx;
  const r2 = await post(verifyPost, { reference: "whisper_ref_011" }, auth);
  const d2 = await r2.json();
  ok("a still-settling transfer is 'pending', not a failure", r2.status === 202 && d2.pending === true);
  ok("…and nothing was credited yet", state.credits.length === 1);

  const emailTx = { status: "success", data: { reference: "whisper_ref_012", amount: 300000, currency: "NGN", status: "success", metadata: { coins: "300", region: "ngn", user_id: OWNER }, customer: { email: "someone.else@gmail.com" } } };
  paystackReply = emailTx;
  const r3 = await post(verifyPost, { reference: "whisper_ref_012" }, auth);
  ok("a charge that named a different email is refused", r3.status === 400);

  const crossedTx = { status: "success", data: { reference: "whisper_ref_013", amount: 300000, currency: "NGN", status: "success", metadata: { coins: "300", region: "ngn", user_id: OTHER }, customer: { email: MASKED } } };
  paystackReply = crossedTx;
  const r4 = await post(verifyPost, { reference: "whisper_ref_013" }, auth);
  ok("a charge owned by another account is refused for this session", r4.status === 403);

  /* Foreign buyer: $1 pack converted at the fixed 1600 NGN/USD. */
  const usdTx = { status: "success", data: { reference: "whisper_ref_014", amount: 160000, currency: "NGN", status: "success", metadata: { coins: "100", region: "usd_via_ngn", user_id: OWNER }, customer: { email: MASKED } } };
  paystackReply = usdTx;
  const r5 = await post(verifyPost, { reference: "whisper_ref_014" }, auth);
  ok("a foreign-converted charge inside the band credits", r5.status === 200 && state.wallets.get(OWNER) === 400);

  const drifted = { status: "success", data: { reference: "whisper_ref_015", amount: 180000, currency: "NGN", status: "success", metadata: { coins: "100", region: "usd_via_ngn", user_id: OWNER }, customer: { email: MASKED } } };
  paystackReply = drifted;
  const r6 = await post(verifyPost, { reference: "whisper_ref_015" }, auth);
  ok("a foreign charge outside the 5% band is refused", r6.status === 400 && state.credits.length === 2);

  const anon = await post(verifyPost, { reference: "whisper_ref_010" }, {});
  ok("an unauthenticated verify is refused", anon.status === 401);
} finally {
  globalThis.fetch = realFetch;
}

/* --------------------------------------------------------------------- */
console.log("5. the source contract: the pieces cannot drift apart");
/* --------------------------------------------------------------------- */

const webhookSrc = await readFile(new URL("../app/api/paystack/webhook/route.ts", import.meta.url), "utf8");
const verifySrc = await readFile(new URL("../app/api/paystack/verify/route.ts", import.meta.url), "utf8");
const creditSrc = await readFile(new URL("../app/api/paystack/credit.ts", import.meta.url), "utf8");
const pageSrc = await readFile(new URL("../app/premium/page.tsx", import.meta.url), "utf8");
const sharedSrc = await readFile(new URL("../lib/paystack/shared.ts", import.meta.url), "utf8");

const webhookHandler = webhookSrc.slice(webhookSrc.indexOf("export async function POST"));
ok("the webhook verifies the signature before it parses or settles anything",
  webhookHandler.indexOf("verifyPaystackSignature") < webhookHandler.indexOf("JSON.parse")
    && webhookHandler.indexOf("JSON.parse") < webhookHandler.indexOf("settleVerifiedPayment"));
ok("an unconfigured webhook refuses loudly instead of opening up",
  /PAYSTACK_WEBHOOK_SECRET is not set — refusing to accept IPN/.test(webhookSrc)
    && webhookSrc.includes('status: 503'));
ok("webhook and verify settle through the same rule chain",
  webhookSrc.includes('from "../credit"') && verifySrc.includes('from "../credit"'));
ok("the rule chain owns the email check, once",
  creditSrc.includes("MASKED_EMAIL") && !/MASKED_EMAIL =/.test(verifySrc));
ok("the masked email has exactly one definition",
  (sharedSrc.match(/whisper\.anonymous\.app@gmail\.com/g) || []).length === 1
    && !pageSrc.includes("whisper.anonymous.app@gmail.com"));
ok("the page buys through the shared email, not its own copy",
  pageSrc.includes('email: MASKED_EMAIL') && pageSrc.includes('from "@/lib/paystack/shared"'));
ok("verify answers pending honestly instead of failing it",
  verifySrc.includes('status: 202') && /pending: true/.test(verifySrc));
ok("the page remembers a payment that left the browser",
  /sessionStorage\.setItem\(\s*PENDING_PAYMENT_KEY/.test(pageSrc));
ok("the page re-verifies an unsettled payment on mount, focus and app resume",
  /void reconcile\(\);/.test(pageSrc)
    && pageSrc.includes('window.addEventListener("focus", onFocus)')
    && /App\.addListener\("resume"/.test(pageSrc));
ok("a settled pending payment is cleared; a rejected one is final",
  (pageSrc.match(/sessionStorage\.removeItem\(PENDING_PAYMENT_KEY\)/g) || []).length >= 2);
ok("re-verification is guarded against concurrent runs",
  /reconcileInFlight\.current/.test(pageSrc));

console.log("\nPAYMENTS FLOW PASSED");
