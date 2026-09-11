import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
async function load(path) {
  const source = ts.transpileModule(await read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const { paymentBelongsToUser } = await load('lib/paymentOwnership.ts');
const owner = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
const reference = `whisper_${owner}_100_12345`;
assert.equal(paymentBelongsToUser({ reference, metadata: { user_id: owner } }, reference, owner), true);
assert.equal(paymentBelongsToUser({ reference, metadata: { user_id: owner } }, reference, other), false);
assert.equal(paymentBelongsToUser({ reference: 'different', metadata: { user_id: owner } }, reference, owner), false);
assert.equal(paymentBelongsToUser({ reference, metadata: { coins: 100 } }, reference, owner), true);
assert.equal(paymentBelongsToUser({ reference, metadata: { coins: 100 } }, reference, other), false);
assert.equal(paymentBelongsToUser({ reference, metadata: { coins: 500 } }, reference, owner), false);
assert.equal(paymentBelongsToUser({ reference: 'unbound' }, 'unbound', owner), false);
console.log('PASS payment binding, legacy ownership, reference mismatch and cross-account denial');

const { isTrustedPushEndpoint } = await load('lib/pushEndpoint.ts');
for (const url of ['https://fcm.googleapis.com/fcm/send/token', 'https://updates.push.services.mozilla.com/wpush/v2/token', 'https://web.push.apple.com/token']) assert.equal(isTrustedPushEndpoint(url), true);
for (const url of ['http://127.0.0.1/', 'https://169.254.169.254/', 'https://fcm.googleapis.com.evil.test/', 'https://fcm.googleapis.com@evil.test/', 'https://fcm.googleapis.com:8443/', 'not a url']) assert.equal(isTrustedPushEndpoint(url), false);
console.log('PASS push endpoint SSRF host, protocol, credentials and port checks');

const { readBoundedImage } = await load('lib/boundedImage.ts');
assert.equal((await readBoundedImage(new Response('123', { headers: { 'content-type': 'image/png' } }), 3)).bytes.byteLength, 3);
assert.equal(await readBoundedImage(new Response('1234', { headers: { 'content-type': 'image/png' } }), 3), null);
assert.equal(await readBoundedImage(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })), null);
assert.equal(await readBoundedImage(new Response('x', { headers: { 'content-type': 'image/png', 'content-length': '999' } }), 3), null);
console.log('PASS bounded image stream with/without Content-Length and active-document rejection');

const { consume } = await load('lib/apiGuard.ts');
const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;
/* consume() is async (durable layer first, in-memory only after one failed
   probe or a missing migration). Await each verdict: a Promise is always
   truthy, so an unawaited assert.ok here would pass even if the limiter said
   "allow" — exactly the kind of vacuous green the suite exists to prevent. */
try {
  assert.equal(await consume('test', 'account', 1, 15 * 60_000), null);
  assert.ok(await consume('test', 'account', 1, 15 * 60_000));
  now += 11 * 60_000;
  // Force a sweep. The old fixed 10-minute expiry silently removed the 15-minute limit.
  for (let i = 0; i < 50_010; i++) await consume('flood', String(i), 1, 60_000);
  assert.ok(await consume('test', 'account', 1, 15 * 60_000));
  assert.ok(await consume('flood', 'new-identity', 1, 60_000)); // bounded: fail CLOSED
  now += 5 * 60_000;
  assert.equal(await consume('test', 'account', 1, 15 * 60_000), null);
} finally { Date.now = realNow; }
console.log('PASS limiter expiry preservation and fail-closed bounded capacity');

const migration = await read('supabase/migrations/202609100001_refund_authorization.sql');
assert.match(migration, /revoke all on function %s from public, anon, authenticated/);
assert.match(migration, /auth.role\(\) is distinct from 'service_role'/);
for (const route of ['feed-post', 'reply']) {
  const source = await read(`app/api/coins/${route}/route.ts`);
  assert.ok(source.includes('supabaseAdmin.rpc("refund_whisper_coins_for"'));
  assert.ok(!source.includes('asUser.rpc("refund_whisper_coins"'));
}
for (const [route, field] of [['photos', 'image'], ['audio', 'audio']]) {
  const source = await read(`app/api/${route}/view/route.ts`);
  assert.ok(source.includes(`.is("${field}_viewed_at", null)`));
  assert.ok(source.includes('if (claim.error)') && source.includes('if (!claim.data)'));
}
console.log('PASS refund authorization and view-once claim source guards (live DB tests still required)');
const privateColumns = await read('supabase/migrations/202609100002_private_column_grants.sql');
assert.match(privateColumns, /revoke %s on table public\.%I from public, anon, authenticated/);
assert.match(privateColumns, /revoke %s \(%s\) on table/);
assert.match(privateColumns, /recovery_phrase_hash/);
assert.match(privateColumns, /has_table_privilege/);
assert.match(privateColumns, /has_column_privilege/);
console.log('PASS private-column grant repair source guards (live DB tests still required)');

const messageGrantRepair = await read('supabase/migrations/202609100003_repair_messages_select_grants.sql');
assert.match(messageGrantRepair, /revoke select on table public\.messages from public, anon, authenticated/);
assert.match(messageGrantRepair, /revoke select \(%s\) on table public\.messages/);
assert.match(messageGrantRepair, /grant select \(%s\) on table public\.messages to anon, authenticated/);
for (const column of ['id', 'recipient_id', 'message', 'image_url', 'created_at', 'is_read']) {
  assert.match(messageGrantRepair, new RegExp(`'${column}'`));
}
for (const column of ['sender_country', 'sender_state', 'sender_city', 'sender_device', 'sender_username', 'sender_email_name', 'sender_user_id']) {
  assert.match(messageGrantRepair, new RegExp(`'${column}'`));
}
console.log('PASS messages safe SELECT grant repair covers notification projections and keeps private columns denied');
// ---------------------------------------------------------------------------
// 20260910 hardening pass: CSP measurement, signed uploads, durable guards,
// session revocation, cron sweep auth. (Client-surface behavior — the call
// timeline, push channels — is covered in notification-targeting.test.mjs.)
// ---------------------------------------------------------------------------

const middleware = await read('middleware.ts');
assert.match(middleware, /Content-Security-Policy-Report-Only/, 'CSP ships report-only: enforce nothing until reports are clean');
assert.match(middleware, /x-nonce/, 'the nonce rides to Next via the request header');
assert.match(middleware, /'strict-dynamic'/, 'trusted inline bootstrap propagates through strict-dynamic');
assert.match(middleware, /\/api\/csp-report/, 'reports have a sink');
const cspSink = await read('app/api/csp-report/route.ts');
assert.match(cspSink, /export async function POST/, 'sink accepts the beacon POST');
assert.match(cspSink, /truncat/i, 'reports are bounded — a sink that stores everything is a DoS gift');
const nextCfg = await read('next.config.ts');
assert.match(nextCfg, /frame-ancestors 'none'/, 'the unbreakable directives are already enforced via config headers');
assert.match(nextCfg, /object-src 'none'; base-uri 'self'; form-action 'self'/, 'the rest of the enforced policy rides with it');
/* The framing pair is chosen by build mode (a dev preview is legitimately
   framed; production is not). The guard has to hold the SHIPPED value, so it
   checks the production branch specifically rather than any occurrence of the
   string — otherwise a future edit could relax production and still pass. */
assert.match(nextCfg, /IS_PRODUCTION\s*\n?\s*\??\s*\n?\s*\?\s*"frame-ancestors 'none'"/, 'production is the no-frames branch');
assert.match(nextCfg, /key: "X-Frame-Options", value: "DENY"/, 'and X-Frame-Options still ships DENY in production');
assert.match(nextCfg, /IS_PRODUCTION[\s\S]{0,200}X-Frame-Options/, 'DENY is inside the production-only branch, so development can be previewed');

const signRoute = await read('app/api/cloudinary/sign/route.ts');
assert.match(signRoute, /startsWith\("Bearer "\)/, 'the signer is authenticated by the same Bearer path the app actually uses');
assert.match(signRoute, /status: 401/, 'no token, no signature');
const cloudServerPre = await read('lib/cloudinary.server.ts');
assert.match(cloudServerPre, /process\.env\.CLOUDINARY_API_SECRET/, 'the api secret is read from env, server-side only');
assert.match(signRoute, /503/, 'unconfigured secret answers 503 (client degrades to the unsigned preset, loudly)');
assert.match(signRoute, /whisper\//, 'every signed folder is namespace-prefixed');
assert.match(signRoute, /owner === user\.id/, 'the owner segment must be the caller');
const cloudClient = await read('lib/cloudinary.ts');
assert.match(cloudClient, /fetch\("\/api\/cloudinary\/sign"/, 'uploads ask the server for a signature');
assert.match(cloudClient, /whisper_unsigned/, 'the unsigned fallback is explicit and documented as transitional');
const cloudServer = await read('lib/cloudinary.server.ts');
assert.match(cloudServer, /signUploadParams/, 'server-side signer exists');

for (const [route, bucket] of [
  ['app/api/photos/view/route.ts', 'view-once-photo'],
  ['app/api/audio/view/route.ts', 'view-once-audio'],
  ['app/api/feed/photo/route.ts', 'feed-photo-view'],
  ['app/api/creator/post/route.ts', 'creator-post'],
]) {
  const source = await read(route);
  assert.ok(source.includes(`await consume("${bucket}"`), `${route} must AWAIT the durable bucket '${bucket}' (sync consume became async; unawaited = unenforced)`);
}

const resetRoute = await read('app/api/reset-with-phrase/route.ts');
assert.match(resetRoute, /revoke_user_sessions/, 'a phrase reset invalidates every old session');

const sweep = await read('app/api/calls/sweep/route.ts');
assert.match(sweep, /CRON_SECRET/, 'the cron endpoint is keyed');
assert.match(sweep, /Bearer \$\{CRON_SECRET\}|header\.startsWith\("Bearer "\)/, 'Vercel-cron auth style');
assert.match(sweep, /rpc\("expire_stale_calls"\)/, 'it calls the server-side expiry, no client logic');
const cronCfg = JSON.parse(await read('vercel.json'));
assert.equal(cronCfg.crons[0].path, '/api/calls/sweep', 'the cron entry exists');

console.log('PASS csp report-only, signed-upload authority, awaited durable guards, revocation and cron auth');
