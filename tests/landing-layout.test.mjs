/**
 * Guards for the landing page's horizontal budget.
 *
 * Every rule below exists because of a measurement, taken in Roboto — which is
 * what Android/Chrome actually renders this page in, since globals.css points
 * `--font-inter` at the system UI stack. The numbers in the comments are those
 * measurements; the assertions are the layout decisions that follow from them,
 * so a future "tidy" cannot quietly put the width back.
 *
 * Measured (Roboto Bold, tracking as the CSS sets it):
 *   hero download label, one line  307.5px   — but a 320px phone gives 288px
 *   the store lockup               142.3px   — same link, same words, 2 lines
 *   navbar at lg, with the badge   886-900px — of a 976px track
 *   navbar at lg, without it       712px
 *   navbar at 320px, "Start Whispering"  331px — of 320px, so it clipped
 *   navbar at 320px, "Start"             241px
 *   banner single row, sm:          662.5px  — of 640px, so it overflowed
 *   banner single row, md: + lockup 624.1px  — of 768px, comfortable
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const [hero, navbar, logo, download, banner, landing, globals, nextConfig, middleware] = await Promise.all([
  read("components/Hero.tsx"),
  read("components/Navbar.tsx"),
  read("components/Logo.tsx"),
  read("components/DownloadAndroidButton.tsx"),
  read("components/home/LandingTopDownloadBanner.tsx"),
  read("app/page.tsx"),
  read("app/globals.css"),
  read("next.config.ts"),
  read("middleware.ts"),
]);

function ok(name, check) {
  assert.ok(check, name);
  console.log(`  ok   ${name}`);
}

console.log("the download control has a lockup that fits the space it is given");

ok(
  "the store lockup says the badge's words, not a truncated label",
  /Get it on/.test(download) && /Google Play/.test(download)
);
ok(
  "its accessible name stays the full one, because the visible words are shorter",
  /aria-label=\{isStore \? label : undefined\}/.test(download)
);
ok(
  "the two lockups are a prop, so one control serves every surface",
  /type Lockup = "inline" \| "store";/.test(download) && /lockup\?: Lockup;/.test(download)
);
ok(
  "the mark is sized for the two-line lockup, not left at its one-line height",
  /const storeMarkSizes: Record<string, number> = \{ sm: 26, md: 28, lg: 30 \};/.test(download) &&
    /const markSize = isStore \? storeMarkSizes\[size\] : iconSizes\[size\];/.test(download)
);
ok(
  "both render paths (live and store-URL-missing) use the chosen lockup",
  (download.match(/size=\{markSize\}/g) || []).length === 2 &&
    (download.match(/\{isStore \? storeLabel : label\}/g) || []).length === 2
);
ok(
  "the hero asks for the compact lockup",
  /lockup="store"/.test(hero) && /Download Android app — Get it on Google Play/.test(hero)
);
ok("the banner asks for it too, and fills the card when stacked", /lockup="store"/.test(banner) && /w-full shrink-0 md:w-auto/.test(banner));

console.log("\nthe hero column is narrower than the narrowest phone");

ok(
  "the primary CTA is one step shorter, so the pair costs less height",
  /premium-button-primary h-11 px-6 text-\[15px\]/.test(hero)
);
ok(
  "the outline CTA matches that height and can fill the column on phones",
  /variant="outline"\s*\n\s*size="md"\s*\n\s*className="h-11 w-full sm:w-auto"/.test(hero)
);
ok(
  "the CTA group is a stack on phones, a row from sm — never two overflowing pills",
  /flex flex-col items-stretch gap-3 sm:flex-row/.test(hero)
);
ok("the download pill cannot exceed the column", /className="max-w-full"/.test(hero));

console.log("\nthe bar gives its controls room instead of squeezing them");

ok(
  "the download badge waits for xl — it was the fourth control in a full row",
  /className="hidden xl:inline-flex"/.test(navbar)
);
ok(
  "the bar owns its padding as classes, so it can respond to the viewport",
  /rounded-2xl px-3 sm:rounded-3xl sm:px-4/.test(navbar) &&
    !/paddingLeft: 16, paddingRight: 16/.test(code(navbar))
);
ok(
  "the four nav links sit closer together",
  /hidden items-center gap-6 lg:flex/.test(navbar)
);
ok(
  "the mobile CTA says one word, and only where it has to",
  /<span className="sm:hidden">Start<\/span>/.test(navbar) &&
    /<span className="hidden sm:inline">Start Whispering<\/span>/.test(navbar) &&
    /aria-label="Start Whispering"/.test(navbar)
);
ok(
  "the wordmark steps down at the smallest widths",
  /compact \? "text-lg sm:text-xl" : "text-3xl"/.test(logo) && /const size = compact \? 32 : 48;/.test(logo)
);

console.log("\nthe banner's row only starts when the row actually fits");

ok(
  "the row starts at md, not sm (662.5px does not fit in 640px)",
  /md:flex-row md:justify-between md:px-5/.test(banner)
);
ok(
  "the long tail of the copy waits for lg",
  /hidden lg:inline/.test(banner) && /lg:hidden/.test(banner)
);

console.log("\nthe page does not pin a block taller than the viewport");

ok(
  "the hero only sticks at lg, where it is two columns and fits the screen",
  /relative z-20 overflow-hidden lg:sticky lg:top-0/.test(landing)
);
ok(
  "the blur feather only renders while the block is actually pinned",
  /className="hidden lg:block"/.test(landing)
);
/* A *fixed* viewport height would pin a box taller than the screen; `min-h-screen`
   on the page itself is fine and is not what this is about. */
ok(
  "nothing in the pinned block is viewport-height-locked",
  !/(^|[\s"])h-(screen|\[100[ds]?vh\])/.test(code(landing))
);
ok("the hero is not asked to stick on its own", !/className="sticky/.test(code(hero)));

console.log("\nthe preview can actually load the CSS these rules live in");

/* The measurement work above is only visible if the stylesheet arrives. Next
   answers cross-origin requests to a dev server with a blanket 403 on
   `/_next/*`, and the preview is served from a different host than the dev
   server — so without these origins listed, every chunk 403s and the page
   paints as raw unstyled HTML, which reads as a layout out of room. */
ok(
  "the sandbox preview origins may load the dev server's own assets",
  /allowedDevOrigins: DEV_PREVIEW_ORIGINS/.test(nextConfig) &&
    /"\*\.arena\.site"/.test(nextConfig) &&
    /"\*\.e2b\.app"/.test(nextConfig)
);
ok(
  "and the list can be extended per environment without editing the file",
  /NEXT_ALLOWED_DEV_ORIGINS/.test(nextConfig)
);

console.log("\nand it can paint, because framing follows the build mode");

ok(
  "production still refuses every frame",
  /IS_PRODUCTION\s*\?\s*"frame-ancestors 'none'"/.test(nextConfig) &&
    /key: "X-Frame-Options", value: "DENY"/.test(nextConfig)
);
ok(
  "development allows the preview ancestors, and nothing else",
  /frame-ancestors 'self' https:\/\/\*\.e2b\.app https:\/\/\*\.arena\.site/.test(nextConfig) &&
    !/frame-ancestors \*/.test(nextConfig)
);
ok(
  "the report-only policy agrees with the enforced one, so it stops crying wolf",
  /process\.env\.NODE_ENV === "production"/.test(middleware) &&
    /frame-ancestors 'self' https:\/\/\*\.e2b\.app https:\/\/\*\.arena\.site/.test(middleware)
);

console.log("\nthe type scale the measurements assume is still in force");
ok(
  "the landing is still in the system stack, so Roboto is the right ruler",
  /--font-inter: ui-sans-serif, system-ui/.test(globals)
);
ok("the hero heading did not grow", /font-size: clamp\(2\.375rem, 6\.4vw, 4\.25rem\);/.test(globals));

console.log("\nLANDING LAYOUT GUARDS PASSED");
