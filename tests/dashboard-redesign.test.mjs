import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [page, feedHook, preview, sidebar, topbar, people, css, publicFeed, linkCard] = await Promise.all([
  read("app/dashboard/page.tsx"),
  read("components/dashboard/useDashboardFeed.ts"),
  read("components/dashboard/PublicFeedPreview.tsx"),
  read("components/dashboard/DashboardSidebar.tsx"),
  read("components/dashboard/DashboardTopbar.tsx"),
  read("components/dashboard/DiscoverPeopleCard.tsx"),
  read("app/globals.css"),
  read("app/public-feed/page.tsx"),
  read("components/LinkCard.tsx"),
]);

function ok(name, check) {
  assert.ok(check, name);
  console.log(`  ok   ${name}`);
}

console.log("dashboard redesign");
ok("keeps the authenticated-session gate", page.includes("getCachedSession") && page.includes('router.replace("/login")'));
ok("keeps profile completion and terms gates", page.includes("profile_completed") && page.includes("TermsModal"));
ok("keeps process-wide presence", page.includes("presenceManager.connect"));
ok("uses the authenticated profile throughout", page.includes("DashboardProfile") && !page.includes("Fonzie"));
ok("retains link, prompt, activity and recent-whisper tools", ["LinkCard", "DailyWhisperCard", "ActivityChart", "RecentMessages"].every((name) => page.includes(name)));

console.log("real dashboard data");
ok("feed preview uses the shared feed API", feedHook.includes("fetchFeedPage") && feedHook.includes("fetchLikes"));
ok("feed interactions write through Supabase", feedHook.includes('from("public_feed_likes")'));
ok("all four real feed sorts are exposed", preview.includes("FEED_SORTS") && preview.includes("feed.setSort"));
ok("post interactions deep-link to the full feed", preview.includes("/public-feed?post=${post.id}"));
ok("people discovery reuses the match RPC", people.includes('rpc("find_match_candidates"'));
ok("friend requests use the existing table", people.includes('from("friend_requests")'));
ok("navigation badges reuse the singleton store", sidebar.includes("subscribeNavBadges") && topbar.includes("subscribeNavBadges"));
ok("topbar search routes into the full public feed", topbar.includes("/public-feed?search="));
ok("public feed initializes sort, topic and search from links", ["requestedSort", "requestedTopic", "requestedSearch"].every((name) => publicFeed.includes(name)));
ok("link copying uses the WebView-safe clipboard helper", linkCard.includes('from "@/lib/clipboard"'));

console.log("responsive shell");
ok("desktop has left, center and right tracks", css.includes("grid-template-columns: clamp(13.5rem") && css.includes(".dashboard-right-rail"));
ok("tablet has a dedicated layout breakpoint", css.includes("@media (max-width: 60rem)"));
ok("mobile has a dedicated layout breakpoint", css.includes("@media (max-width: 44rem)"));
ok("bottom navigation returns when the sidebar disappears", /@media \(max-width: 78rem\)[\s\S]*?\.dashboard-bottom-nav \{ display:block; \}/.test(css));
ok("reduced motion disables decorative dashboard animation", /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dashboard-feed-skeleton::after \{ animation:none; \}/.test(css));

console.log("\nDASHBOARD GUARDS PASSED");

const [hero, streakChip, modal, rail] = await Promise.all([
  read("components/dashboard/DashboardHero.tsx"),
  read("components/StreakChip.tsx"),
  read("components/Modal.tsx"),
  read("components/dashboard/DashboardRightRail.tsx"),
]);
console.log("mobile dashboard regression guards");
ok("welcome prioritizes real actions over a decorative phone", hero.includes("StreakChip") && !hero.includes("WhisperPhoneMockup"));
ok("check-in escapes clipped ancestors through the shared modal", streakChip.includes("<Modal open={open}") && modal.includes("createPortal(") && !streakChip.includes("absolute right-0 top-12"));
ok("streak trigger identifies its dialog and labels the action", streakChip.includes('aria-haspopup="dialog"') && streakChip.includes('pending ? "Check in"'));
ok("check-in retains the server-backed action and reward dialog", streakChip.includes("await checkIn()") && streakChip.includes("<StreakRewardDialog"));
ok("streak dialog supports short screens", streakChip.includes("max-h-[85dvh] overflow-y-auto"));
ok("stats appear once, before the sharing tools", page.indexOf("<StatsRow") < page.indexOf('id="whisper-link"') && !rail.includes("<StatsRow"));
ok("secondary tools are disclosed on demand", page.includes('<details id="engagement"') && page.includes("Daily prompt"));
ok("community preview is limited to two posts", preview.includes("slice(0, 2)"));
ok("mobile search remains accessible on demand", topbar.includes('aria-controls="dashboard-search"') && css.includes(".dashboard-global-search.is-open"));

const [postCard, inboxMenu] = await Promise.all([
  read("components/feed/FeedPostCard.tsx"),
  read("components/inbox/InboxChatMenu.tsx"),
]);
ok("reply branches no longer inherit expansion from parents", !postCard.includes("threadOpen") && postCard.includes("Boolean(controller.expanded[node.id])"));
ok("shared reply links reveal only their ancestor path", publicFeed.includes("chain.slice(0, -1)"));
ok("inbox actions escape clipping and close on scroll", inboxMenu.includes("createPortal(") && inboxMenu.includes('addEventListener("scroll", onClose, true)'));
ok("dialogs have opaque surfaces", modal.includes('background: "var(--theme-surface-solid)"'));
ok("both themes share opaque chrome tokens", css.includes('--theme-glass-chrome: var(--theme-surface-solid)'));
ok("dashboard restores hover and keyboard edge lighting", css.includes('.dashboard-shell .edge-lit:hover') && css.includes('.dashboard-shell .edge-lit:focus-within'));
