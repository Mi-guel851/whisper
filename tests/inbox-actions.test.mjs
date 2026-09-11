/**
 * Guards for three changes that are easy to undo by accident:
 *
 *   1. the download-app button carries the OFFICIAL COLOURED Google Play mark
 *      (four brand colours, vector, never a tinted mono triangle),
 *   2. received whispers support press-and-hold multi-select — select all,
 *      then delete the selection in one authorized request,
 *   3. blocking someone from the inbox, which is only a real block if the
 *      server (not the button) refuses the next whisper.
 *
 * Static source guards, in the style of every other test here: the files are
 * the contract, and each assertion names the behaviour that would silently
 * disappear if the line were removed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  playIcon,
  downloadButton,
  choosePlatform,
  whispers,
  deleteRoute,
  blocks,
  inboxMenu,
  inboxPage,
  blockMigration,
  testScripts,
] = await Promise.all([
  read("components/PlayStoreIcon.tsx"),
  read("components/DownloadAndroidButton.tsx"),
  read("app/choose-platform/page.tsx"),
  read("app/notifications/page.tsx"),
  read("app/api/messages/delete/route.ts"),
  read("lib/blocks.ts"),
  read("components/inbox/InboxChatMenu.tsx"),
  read("app/inbox/page.tsx"),
  read("supabase/migrations/202609120002_inbox_blocking.sql"),
  read("package.json"),
]);

/** Guards match code, not the comments that explain it: several of these
    files document the very thing the guard asserts against (the icon's note
    names `currentColor` to explain why it is absent). */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function ok(name, check) {
  assert.ok(check, name);
  console.log(`  ok   ${name}`);
}

/* ------------------------------------------------------------------------- */
console.log("the download button carries the real store mark");
/* ------------------------------------------------------------------------- */

/* The four brand hexes, each exactly once: blue chevron, green top wedge, red
   bottom wedge, yellow fold. A single-tint or two-tone approximation is the
   regression this guards. */
const brandColours = ["#4285F4", "#34A853", "#EA4335", "#FBBC04"];
ok(
  "all four official Play colours are present",
  brandColours.every((colour) => playIcon.toUpperCase().includes(colour))
);
ok("the mark is drawn on the official 256:283 canvas", /viewBox="0 0 256 283"/.test(playIcon));
ok("colour can never be inherited from the theme", !/currentColor/.test(code(playIcon)));
ok(
  "the four paths are the official geometry, not a re-draw",
  (playIcon.match(/fill="#4|fill="#3|fill="#E|fill="#F/g) || []).length >= 4 &&
    /M1\.06 23\.487/.test(playIcon) &&
    /m120\.436 141\.274/.test(playIcon)
);
ok("size means height, and the width follows the aspect ratio", /width=\{\(size \* 256\) \/ 283\}/.test(playIcon));
ok(
  "an accessible name is opt-in, because the mark sits beside its own label",
  /role=\{title \? "img" : undefined\}/.test(playIcon) && /aria-hidden=\{title \? undefined : true\}/.test(playIcon)
);
ok(
  "every download button passes the icon at the button's own scale",
  (downloadButton.match(/<PlayStoreIcon size=\{iconSizes\[size\]\} \/>/g) || []).length === 2 &&
    /const iconSizes: Record<string, number> = \{ sm: 18, md: 20, lg: 22 \};/.test(downloadButton)
);
ok(
  "the disabled (no store URL yet) button shows the same mark, not a placeholder",
  downloadButton.includes("Play Store link coming soon") && /opacity-70/.test(downloadButton)
);
ok(
  "the choose-platform card shows the coloured mark on its white tile",
  (choosePlatform.match(/<PlayStoreIcon/g) || []).length === 2
);

/* ------------------------------------------------------------------------- */
console.log("whispers: press and hold, select all, delete together");
/* ------------------------------------------------------------------------- */

ok("the hold is the chat list's hold (one gesture vocabulary)", /const LONG_PRESS_MS = 420;/.test(whispers));
ok("a held press enters selection mode with that whisper ticked", /setSelectionMode\(true\);\s*setSelectedIds\(new Set\(\[id\]\)\);/.test(whispers));
ok("a plain tap still opens the whisper", /if \(selectionMode\) \{\s*toggleSelected\(item\.id\);\s*return;\s*\}\s*void openNotification\(item\);/.test(whispers));
ok("the press that ended as a hold does not also count as the opening tap", /if \(longPressed\.current\) \{\s*longPressed\.current = false;\s*return;\s*\}/.test(whispers));
ok(
  "there is a select-all, and its opposite when everything is ticked",
  /function selectAll\(\)/.test(whispers) && /allSelected \? "Clear all" : "Select all"/.test(whispers) && /const allSelected = notifications\.length > 0 && selectedIds\.size === notifications\.length;/.test(whispers)
);
ok("clearing the ticks is not the same as leaving selection mode", /function clearSelected\(\)/.test(whispers) && /Select all|Clear all/.test(whispers));
ok("the selection bar reports the count live", /aria-live="polite"/.test(whispers) && /\{selectedIds\.size\} selected/.test(whispers));
ok(
  "delete is unavailable with nothing selected",
  /disabled=\{selectedIds\.size === 0 \|\| deleting\}/.test(whispers)
);
ok(
  "the row's own controls keep their own meaning while holding",
  /data-no-longpress/.test(whispers) && (whispers.match(/data-no-longpress/g) || []).length >= 3
);
ok(
  "the dialog counts the selection instead of saying 'this message'",
  /pendingDelete\.length > 1 \? `Delete \$\{pendingDelete\.length\} whispers\?` : "Delete this whisper\?"/.test(whispers)
);
ok(
  "one authorized request deletes the whole selection",
  /body: JSON\.stringify\(\s*items\.length === 1 \? \{ messageId: items\[0\]\.id \} : \{ messageIds: items\.map\(\(item\) => item\.id\) \}/.test(whispers)
);
ok(
  "the delete route accepts a bounded batch as well as a single id",
  /messageIds\?: unknown/.test(deleteRoute) && /const MAX_BATCH = 200;/.test(deleteRoute) && /\.slice\(0, MAX_BATCH\)/.test(deleteRoute)
);
ok(
  "the route still deletes only what the caller received",
  /\.filter\(\(row\) => row\.recipient_id === user\.id\)/.test(deleteRoute) &&
    /\.delete\(\)\s*\.in\("id", ownedIds\)\s*\.eq\("recipient_id", user\.id\)/.test(deleteRoute)
);
ok("the route reports how many rows it removed", /deleted: ownedIds\.length/.test(deleteRoute));

/* ------------------------------------------------------------------------- */
console.log("blocking someone from the inbox");
/* ------------------------------------------------------------------------- */

ok("the block lives in an RPC, self-only and idempotent", /create or replace function public\.block_user\(p_user_id uuid\)/.test(code(blockMigration)) && /on conflict \(user_id, blocked_user_id\) do nothing/.test(code(blockMigration)));
ok("unblocking exists, or a block is a one-way door", /create or replace function public\.unblock_user\(p_user_id uuid\)/.test(code(blockMigration)));
ok("a block also ends the friendship, both directions", /delete from public\.friends f/.test(code(blockMigration)) && /f\.user_id = v_me and f\.friend_id = p_user_id/.test(code(blockMigration)));
ok("a pending friend request is withdrawn with the block", /delete from public\.friend_requests r/.test(code(blockMigration)));
ok("a ringing call between the two is cancelled, a live one is not", /where cl\.status = 'ringing'/.test(code(blockMigration)) && !/status in \('ringing','answered'\)/.test(code(blockMigration)));
ok("the table states that only the blocker may remove the block", /create policy "Users can remove their own blocks" on public\.blocked_users\s*for delete to authenticated using \(auth\.uid\(\) = user_id\)/.test(code(blockMigration)));
ok("new whispers are refused while a block exists, in either direction", /before insert on public\.messages/.test(code(blockMigration)) && /b\.user_id = v_sender and b\.blocked_user_id = v_recipient/.test(code(blockMigration)) && /raise exception 'This conversation is blocked\.'/.test(code(blockMigration)));
ok("the guard reads its columns defensively", /to_jsonb\(new\)->>'sender_id'/.test(code(blockMigration)) && /to_jsonb\(new\)->>'recipient_id'/.test(code(blockMigration)));
ok("the client never writes the table directly — the RPC is the writer", /rpc\("block_user", \{ p_user_id: userId \}/.test(blocks) && /rpc\("unblock_user", \{ p_user_id: userId \}/.test(blocks));
ok(
  "the app only reads blocks it placed itself, so a block is never disclosed",
  /\.eq\("user_id", myId\)/.test(blocks) && /Only the rows this user placed/.test(blocks)
);
ok("the menu offers Block, set apart and coloured", /isBlocked \? "Unblock" : "Block"/.test(inboxMenu) && /bg-white\/10" aria-hidden/.test(inboxMenu) && /text-red-300/.test(inboxMenu));
ok(
  "blocking asks first instead of acting on the tap that opened the sheet",
  /onClose\(\);\s*onBlock\(\);/.test(inboxMenu) && /onConfirm=\{confirmBlock\}/.test(inboxPage) && /title=\{pendingBlock\.blocked \? `Unblock \$\{pendingBlock\.label\}\?` : `Block \$\{pendingBlock\.label\}\?`\}/.test(inboxPage)
);
ok(
  "the list re-reads the server after a block, because a block changes the friendship",
  /setReloadToken\(\(token\) => token \+ 1\);/.test(inboxPage) && /\}, \[reloadToken\]\);/.test(inboxPage)
);
ok(
  "a failed block closes the dialog and says why, instead of leaving it open",
  /setPendingBlock\(null\);\s*showToast\(result\.error\);/.test(inboxPage)
);
ok(
  "the toast reports the outcome the server reached, not the button the user pressed",
  /result\.status === "not_blocked"/.test(inboxPage) && /result\.status === "already_blocked"/.test(inboxPage)
);
ok("the guard suite is wired into npm test", /tests\/inbox-actions\.test\.mjs/.test(testScripts));

console.log("\nINBOX ACTION GUARDS PASSED");
