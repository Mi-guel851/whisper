import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/* -- The server owns the inbox ordering. ---------------------------------- */

const migration = await read('supabase/migrations/202609100004_inbox_conversation_ordering.sql');

// The trigger stamps the conversation from the inserted row's SERVER time,
// not the device clock.
assert.match(migration, /create or replace function public\.touch_conversation_on_message\(\)/);
assert.match(migration, /security definer/);
assert.match(migration, /last_message_at = new\.created_at/);
assert.match(migration, /last_message_sender_id = new\.sender_id/);
assert.match(migration, /create trigger direct_messages_touch_conversation\s+after insert on public\.direct_messages/);

// The trigger function is never meant to be called directly.
assert.match(migration, /revoke all on function public\.touch_conversation_on_message\(\) from public, anon, authenticated/);

// One-shot repair so existing drifted conversations re-sort on apply.
assert.match(migration, /update public\.conversations c/);
assert.match(migration, /select distinct on \(conversation_id\) conversation_id, created_at, sender_id/);

/* -- Exact previews, with the membership re-assert definer requires. ------ */

assert.match(migration, /create or replace function public\.inbox_message_previews\(p_conversation_ids uuid\[\]\)/);
assert.match(migration, /select distinct on \(m\.conversation_id\)/);
assert.match(migration, /c\.user_a = auth\.uid\(\) or c\.user_b = auth\.uid\(\)/);
assert.match(migration, /revoke all on function public\.inbox_message_previews\(uuid\[\]\) from public, anon/);
assert.match(migration, /grant execute on function public\.inbox_message_previews\(uuid\[\]\) to authenticated/);

console.log('PASS inbox ordering: conversation stamp is server-side and existing rows are repaired');

/* -- The client write survives only as a guarded fallback. ---------------
   When the 202609100004 trigger is present its stamp is seconds old, so the
   guard makes the write a no-op and a skewed device clock can no longer
   overwrite the server's value. On an unmigrated database the guard passes,
   so deploy order (app before migration) cannot freeze the inbox. */

const chatPage = await read('app/chat/[conversationId]/page.tsx');
assert.match(chatPage, /const stampConversationFallback = useCallback/);
assert.match(chatPage, /last_message_at: new Date\(\)\.toISOString\(\)/);
assert.match(chatPage, /\.or\(`last_message_at\.is\.null,last_message_at\.lt\.\$\{cutoff\}`\)/);
// The guard carries a skew tolerance, not a bare "older than now".
assert.match(chatPage, /new Date\(Date\.now\(\) - 5 \* 60_000\)/);
// All three send paths go through the same guarded helper.
assert.equal((chatPage.match(/stampConversationFallback\(/g) || []).length, 3, 'three call sites: text, media, photo');
// Messages are still inserted exactly as before.
assert.match(chatPage, /from\("direct_messages"\)\s*\.insert\(/);

/* -- The inbox reads exact previews from the RPC, windowed query as
   fallback for an unmigrated database. ------------------------------------ */

const inboxPage = await read('app/inbox/page.tsx');
assert.match(inboxPage, /supabase\.rpc\("inbox_message_previews"/);
assert.match(inboxPage, /p_conversation_ids: ids/);
assert.match(inboxPage, /\.limit\(600\)/);

console.log('PASS inbox ordering: client writes removed, previews exact with windowed fallback');
