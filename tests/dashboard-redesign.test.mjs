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
