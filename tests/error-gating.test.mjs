import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
async function load(path) {
  const source = ts.transpileModule(await read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = async (path) =>
  ts.transpileModule(await read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;

const { safeErrorMessage, setDebugErrors, debugErrorsEnabled, rawErrorText, SAFE_GENERIC, SAFE_OFFLINE, SAFE_FEATURE_MISSING, SAFE_RATE_LIMITED } = await load('lib/safeErrorMessage.ts');

/* -- The gate's whole job: no server detail in anything it returns. ---- */

const leaks = [
  // PostgREST / Postgres internals, as the Supabase client shapes them.
  { message: 'PGRST202: could not find the function public.admin_bans_page()', code: 'PGRST202' },
  { message: '42P01: relation "public.profiles" does not exist', code: '42P01' },
  { message: 'new row violates row-level security policy: "profiles_insert_policy"', code: '42501' },
  { message: 'duplicate key value violates unique constraint "profiles_username_key"', code: '23505' },
  { message: 'syntax error at or near "SELECT"', code: '42601' },
  { message: 'permission denied for table public.admin_bans', code: '42501' },
  // Browser/WebView fetch failures.
  new Error('Failed to fetch'),
  new Error('NetworkError when attempting to fetch resource'),
  'Load failed',
  // Random internal throw.
  new Error('boom: internal state corrupt at handleSomething'),
];

assert.equal(debugErrorsEnabled(), false);
for (const leak of leaks) {
  const shown = safeErrorMessage(leak);
  assert.ok(!/pgrst|sqlstate|row-level security|constraint|relation "|public\.|syntax error|permission denied|failed to fetch|networkerror/i.test(shown), `leaked: ${JSON.stringify(shown)}`);
}

/* -- What users must still be told passes through verbatim. ------------- */

assert.equal(safeErrorMessage(new Error('Invalid login credentials')), 'Invalid login credentials');
assert.equal(safeErrorMessage(new Error('Email not confirmed')), 'Email not confirmed');
assert.equal(safeErrorMessage(new Error('User already registered')), 'User already registered');
assert.equal(safeErrorMessage(new Error('Password should be at least 8 characters')), 'Password should be at least 8 characters');
// The ban trigger raises this exact sentence — a banned user must be told.
assert.equal(
  safeErrorMessage({ message: 'Your account has been restricted from using Whisper.', code: 'WH001' }),
  'Your account has been restricted from using Whisper.'
);
// OAuth-style payload: the description is what the user would otherwise get.
assert.equal(safeErrorMessage({ error: 'access_denied', error_description: 'The user denied the request' }), 'The user denied the request');

/* -- Categories get their own sentences. -------------------------------- */

assert.equal(safeErrorMessage({ message: 'PGRST202: could not find the function public.x()', code: 'PGRST202' }), SAFE_FEATURE_MISSING);
assert.equal(safeErrorMessage({ message: '42883: function does not exist', code: '42883' }), SAFE_FEATURE_MISSING);
assert.equal(safeErrorMessage(new Error('Failed to fetch')), SAFE_OFFLINE);
assert.equal(safeErrorMessage(new Error('Load failed')), SAFE_OFFLINE);
assert.equal(safeErrorMessage({ message: 'Too many requests', code: '429' }), SAFE_RATE_LIMITED);

/* -- Fallback override for call sites that know the kind of failure. ---- */

assert.equal(safeErrorMessage(new Error('boom'), "Couldn't send that message."), "Couldn't send that message.");
assert.equal(safeErrorMessage(null), SAFE_GENERIC);
assert.equal(safeErrorMessage(undefined, 'Nothing to show here.'), 'Nothing to show here.');
assert.equal(rawErrorText(new Error('boom: internal')), 'boom: internal');
assert.equal(rawErrorText({ code: '42501' }), '42501');
assert.equal(rawErrorText(null), '');

console.log('PASS error gate: no SQLSTATE, RLS, schema or framework detail reaches the user; auth, ban and offline copy pass through');

/* -- Admin debug mode: the two allowlisted accounts read the real text. - */

const rawPostgres = { message: 'PGRST202: could not find the function public.admin_bans_page()', code: 'PGRST202' };
setDebugErrors(true);
assert.equal(debugErrorsEnabled(), true);
assert.equal(safeErrorMessage(rawPostgres), rawPostgres.message);
assert.equal(safeErrorMessage(new Error('Failed to fetch')), 'Failed to fetch');
assert.equal(safeErrorMessage(new Error('boom: internal')), 'boom: internal');
setDebugErrors(false);
assert.equal(debugErrorsEnabled(), false);
assert.ok(!/pgrst|failed to fetch|boom/i.test(safeErrorMessage(rawPostgres)));
assert.equal(safeErrorMessage(new Error('boom: internal')), SAFE_GENERIC);
console.log('PASS admin debug mode flips the gate back to real text and off again');

/* -- errorTextFor: server side, checked against the server allowlist. ---
   lib/errorTextFor.ts imports two path-aliased modules; the data-URL harness
   has no alias, so the two specifiers are rewritten to the transpiled
   dependency-free modules it loads. */

const safeUrl = dataUrl(await transpile('lib/safeErrorMessage.ts'));
const emailsUrl = dataUrl(await transpile('lib/admin/emails.ts'));
let errorTextForSource = await transpile('lib/errorTextFor.ts');
errorTextForSource = errorTextForSource
  .replaceAll('"@/lib/safeErrorMessage"', `"${safeUrl}"`)
  .replaceAll('"@/lib/admin/emails"', `"${emailsUrl}"`);
const { errorTextFor } = await import(dataUrl(errorTextForSource));

const safeMsg = 'Something went wrong. Please try again.';
const adminA = { email: 'mfonisobassey851@gmail.com' };
const adminB = { email: 'basseyaniekeme43@gmail.com' };
for (const admin of [adminA, adminB]) {
  assert.equal(errorTextFor(admin, rawPostgres, safeMsg), rawPostgres.message);
  assert.equal(errorTextFor({ email: admin.email.toUpperCase() }, rawPostgres, safeMsg), rawPostgres.message);
  assert.equal(errorTextFor(admin, 'cloudinary said no', safeMsg), 'cloudinary said no');
}
// Everyone else — including signed-in regular users — always gets the safe text.
assert.equal(errorTextFor({ email: 'someone.else@gmail.com' }, rawPostgres, safeMsg), safeMsg);
assert.equal(errorTextFor(null, rawPostgres, safeMsg), safeMsg);
assert.equal(errorTextFor(undefined, rawPostgres, safeMsg), safeMsg);
// An admin with an empty error still gets the safe sentence, not a blank.
assert.equal(errorTextFor(adminA, null, safeMsg), safeMsg);
console.log('PASS errorTextFor: real text for the two allowlisted admin accounts only, server-side');

/* -- The app-level boundaries exist, so Next's default developer-facing --
   screen can never be the one users see. -------------------------------- */

const errorBoundary = await read('app/error.tsx');
assert.match(errorBoundary, /"use client"/);
assert.match(errorBoundary, /ErrorBoundary/);
assert.match(errorBoundary, /console\.error/);
assert.match(errorBoundary, /debugErrorsEnabled/);
assert.doesNotMatch(errorBoundary, /Application error/);

const globalError = await read('app/global-error.tsx');
assert.match(globalError, /"use client"/);
assert.match(globalError, /<html/i);
assert.match(globalError, /<body/i);
assert.match(globalError, /console\.error/);

const notFound = await read('app/not-found.tsx');
assert.doesNotMatch(notFound, /could not be found/i);

const layout = await read('app/layout.tsx');
assert.match(layout, /<AdminDebugGate\s*\/>/);
const debugGate = await read('components/AdminDebugGate.tsx');
assert.match(debugGate, /setDebugErrors/);
assert.match(debugGate, /isAdminEmail/);
console.log('PASS error boundaries present and the admin debug flag is wired from the session');

/* -- Route-level rules. ---------------------------------------------------
   Admin routes: only the two allowlisted accounts can reach them
   (requireAdmin per request), so they return the real text; the detail is
   still written to the deployment log next to it. */

const adminRoutes = [
  'app/api/admin/announcements/route.ts',
  'app/api/admin/announcements/[id]/route.ts',
  'app/api/admin/audit-logs/route.ts',
  'app/api/admin/bans/route.ts',
  'app/api/admin/bans/[userId]/route.ts',
  'app/api/admin/coins/history/route.ts',
  'app/api/admin/grant-coins/route.ts',
  'app/api/admin/reports/route.ts',
  'app/api/admin/reports/[id]/route.ts',
  'app/api/admin/stats/route.ts',
  'app/api/admin/users/route.ts',
  'app/api/admin/users/[id]/route.ts',
];
for (const route of adminRoutes) {
  const source = await read(route);
  assert.match(source, /console\.error\(/, `${route} must keep logging the detail`);
}

/* User-facing routes: any signed-in user can call them, so the raw text may
   only leave through errorTextFor, which checks the server allowlist. */
const userRoutes = [
  'app/api/cloudinary/destroy/route.ts',
  'app/api/coins/feed-post/route.ts',
  'app/api/coins/reply/route.ts',
  'app/api/creator/post/route.ts',
  'app/api/set-recovery-phrase/route.ts',
];
for (const route of userRoutes) {
  const source = await read(route);
  assert.match(source, /errorTextFor\(/, `${route} must gate raw text behind errorTextFor`);
  if (route.endsWith('creator/post/route.ts')) {
    // The one allowed passthrough: the curated 22023 branch, whose DB messages
    // ("Post body must be between 1 and 500 characters", ...) are user-facing
    // copy raised by create_whisper_creator_post itself. No other raw echo.
    assert.equal((source.match(/error:\s*insertError\.message/g) || []).length, 1);
    assert.match(source, /insertError\?\.code === "22023"/);
  } else {
    assert.doesNotMatch(source, /Response\.json\(\{\s*error:\s*\w+(Error|error)\.message\s*[,}]/, `${route} echoes a raw error message`);
  }
}
console.log('PASS admin routes log and answer in real text; user-facing routes gate raw text behind the server allowlist');
