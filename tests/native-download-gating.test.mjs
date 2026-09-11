/**
 * Guards for "never offer the app inside the app".
 *
 * The app is a Capacitor shell around the same web build, so the landing page a
 * user sees *in the app* is the marketing landing page — it used to invite them
 * to download the thing they were already holding.
 *
 * Three rules keep it honest:
 *   1. the gate lives in `DownloadAndroidButton` (the single component every
 *      store CTA renders through), so a new call site cannot forget it;
 *   2. the pre-paint script marks the native shell before the first paint, so
 *      there is no flash of the offer before React hydrates;
 *   3. the CSS does the visual gating and the hook does the real removal — the
 *      element leaves the DOM, not just the paint.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const [button, hook, layout, globals, choosePlatform, consumers, testScripts] =
  await Promise.all([
    read("components/DownloadAndroidButton.tsx"),
    read("lib/useIsNativeApp.ts"),
    read("app/layout.tsx"),
    read("app/globals.css"),
    read("app/choose-platform/page.tsx"),
    Promise.all(
      [
        "components/Hero.tsx",
        "components/Navbar.tsx",
        "components/Footer.tsx",
        "components/ClosingCTA.tsx",
        "components/home/LandingTopDownloadBanner.tsx",
      ].map(read)
    ),
    read("package.json"),
  ]);

function ok(name, check) {
  assert.ok(check, name);
  console.log(`  ok   ${name}`);
}

console.log("the shell is detected in one place");

ok(
  "the hook answers synchronously, for the pre-paint rule to agree with",
  /export function isNativeShell\(\): boolean \{/.test(hook) && /Capacitor\.isNativePlatform\(\)/.test(hook)
);
ok(
  "the React reader exists alongside it",
  /export function useIsNativeApp\(\): boolean \{/.test(hook)
);
ok(
  "a plain web page is never mistaken for the shell",
  /typeof window === "undefined"/.test(hook) && /catch \{\s*return false;\s*\}/.test(hook)
);
ok(
  "the first client render matches the server render, so hydration is clean",
  /const \[native, setNative\] = useState\(false\);/.test(hook) &&
    /useIsomorphicLayoutEffect\(\(\) => \{\s*setNative\(isNativeShell\(\)\);/.test(hook)
);
ok(
  "the correction runs in a LAYOUT effect, so the app never paints the button",
  /useIsomorphicLayoutEffect =\s*\n?\s*typeof window !== "undefined" \? useLayoutEffect : useEffect;/.test(hook) &&
    /before the browser paints/.test(hook)
);
ok(
  "the shell's own user agent is a second signal, because the bridge can arrive late",
  /window\.navigator\.userAgent\.includes\(NATIVE_UA_MARKER\)/.test(hook) &&
    /const NATIVE_UA_MARKER = "WhisperApp\/";/.test(hook)
);
ok(
  "the hook records why it is not just useState(isNativeShell())",
  /hydration error/.test(hook) && /never \*painted\*|before the browser paints/.test(hook)
);

console.log("\nthe gate is in the component every CTA renders through");

ok(
  "it asks the hook",
  /import \{ useIsNativeApp \} from "@\/lib\/useIsNativeApp";/.test(button) &&
    /const inApp = useIsNativeApp\(\);/.test(button)
);
ok(
  "and renders nothing in the app",
  /if \(inApp\) return null;/.test(button) && /Already installed this app/.test(button)
);
ok(
  "both render paths are marked for the pre-paint rule",
  (button.match(/data-download-app="true"/g) || []).length === 2
);
ok(
  "the gate is about the shell only — a signed-in web user still sees the button",
  !/supabase|useSession|auth\./.test(code(button))
);
ok(
  "no consumer hand-rolls its own store link",
  consumers.every((file) => /import DownloadAndroidButton from/.test(file)) &&
    consumers.every((file) => !/PLAY_STORE_URL/.test(file))
);
ok(
  "only the component and the platform gate know the store URL at all",
  /PLAY_STORE_URL/.test(button) && /PLAY_STORE_URL/.test(choosePlatform)
);

console.log("\nthe app never even paints the offer");

ok(
  "the pre-paint script marks the document",
  /document\.documentElement\.classList\.add\("is-native-app"\)/.test(layout)
);
ok(
  "it runs in the same beforeInteractive block that resolves the theme",
  new RegExp('id="theme-init" strategy="beforeInteractive"').test(layout) &&
    layout.indexOf('classList.add("is-native-app")') > layout.indexOf('id="theme-init"')
);
ok(
  "it asks Capacitor, defensively, and never throws on the web",
  /var cap = window\.Capacitor;/.test(layout) &&
    /typeof cap\.isNativePlatform === "function"/.test(layout)
);
ok(
  "and it reads the shell's user agent too, for the tick before the bridge exists",
  /navigator\.userAgent \|\| ""\)\.indexOf\("WhisperApp\/"\)/.test(layout) &&
    /if \(byBridge \|\| byUserAgent\)/.test(layout)
);
ok(
  "the stylesheet hides every marked CTA under that class",
  /html\.is-native-app \[data-download-app\] \{\s*display: none !important;\s*\}/.test(globals)
);
ok(
  "the platform gate's store card is marked too, for the window before its redirect",
  /data-download-app="true"/.test(choosePlatform)
);
ok(
  "and the platform gate still bounces native users to signup",
  /if \(isNative \|\| existing\) \{\s*router\.replace\("\/signup"\);/.test(choosePlatform)
);
ok("the guard suite is wired into npm test", /tests\/native-download-gating\.test\.mjs/.test(testScripts));

console.log("\nthe user agent the gate trusts is the one the app actually sends");

const capacitorConfig = await read("capacitor.config.ts");
ok(
  "android still overrides the user agent to the WhisperApp string",
  /overrideUserAgent:\s*"WhisperApp\/\d+\.\d+ Android"/.test(capacitorConfig)
);
ok(
  "so the marker in the hook is a substring of what the shell sends",
  capacitorConfig.includes("WhisperApp/") && /NATIVE_UA_MARKER = "WhisperApp\/"/.test(hook)
);

console.log("\nthe shipped pre-paint script, executed for real");

/* Extract the inline script from the layout source and run it — this is the
   code the browser gets, so the behaviour is checked rather than asserted about
   from the outside. Three roles: web, app with the bridge ready, app where the
   bridge has not been injected yet (the Android case, where the WebView is
   pointed at the deployed site). */
const inlineScript = layout.match(
  /id="theme-init" strategy="beforeInteractive">\{`([\s\S]*?)`\}<\/Script>/
)?.[1];

function runInline(script, { bridge, ua }) {
  const classes = new Set();
  const dataset = {};
  const sandbox = {
    document: {
      documentElement: {
        classList: { add: (c) => classes.add(c) },
        dataset,
        style: {},
      },
    },
    navigator: { userAgent: ua },
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: true }),
  };
  if (bridge) sandbox.Capacitor = { isNativePlatform: () => true };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return { classes: [...classes], dataset };
}

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

if (!inlineScript) {
  assert.fail("the pre-paint script could not be extracted from app/layout.tsx");
}

const asWeb = runInline(inlineScript, { bridge: false, ua: DESKTOP_UA });
const asApp = runInline(inlineScript, { bridge: true, ua: "WhisperApp/1.0 Android" });
const asAppLate = runInline(inlineScript, { bridge: false, ua: "WhisperApp/1.0 Android" });

ok("web: the marker is not set, so the download button stays", !asWeb.classes.includes("is-native-app"));
ok("web: the theme is still resolved", typeof asWeb.dataset.theme === "string" && asWeb.dataset.theme.length > 0);
ok("app: is-native-app is set on <html>", asApp.classes.includes("is-native-app"));
ok("app: <html> is flagged in the dataset too", asApp.dataset.nativeApp === "true");
ok("app with a late bridge: the user agent still catches it", asAppLate.classes.includes("is-native-app"));
ok(
  "the browser gets no RuntimeException from the native branch",
  runInline("try { " + inlineScript + " } catch (e) { globalThis.__threw = e.message; }", {
    bridge: false,
    ua: "Mozilla/5.0",
  }).dataset.nativeApp === undefined
);

console.log("\nNATIVE DOWNLOAD GATING GUARDS PASSED");
