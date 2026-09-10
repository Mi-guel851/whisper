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
try {
  assert.equal(consume('test', 'account', 1, 15 * 60_000), null);
  assert.ok(consume('test', 'account', 1, 15 * 60_000));
  now += 11 * 60_000;
  // Force a sweep. The old fixed 10-minute expiry silently removed the 15-minute limit.
  for (let i = 0; i < 50_010; i++) consume('flood', String(i), 1, 60_000);
  assert.ok(consume('test', 'account', 1, 15 * 60_000));
  assert.ok(consume('flood', 'new-identity', 1, 60_000));
  now += 5 * 60_000;
  assert.equal(consume('test', 'account', 1, 15 * 60_000), null);
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
console.log('PASS private-column grant repair source guards (live DB tests still required)');
