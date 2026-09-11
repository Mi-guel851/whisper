"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * "Am I running inside the Whisper app?"
 *
 * The app is a Capacitor shell around this same web build, so the app's landing
 * page *is* the landing page — which is why it used to offer a download button
 * to someone who had already downloaded it. Anything that advertises the app
 * needs to ask this first.
 *
 * TWO READERS, ON PURPOSE
 *
 * `isNativeShell()` answers synchronously and is safe anywhere. `useIsNativeApp()`
 * is the React reader.
 *
 * Why the hook is not `useState(isNativeShell())`:
 *
 * The page is server-rendered, and the server has no idea it is talking to a
 * Capacitor WebView — it renders the download button into the HTML. If the
 * client's first render returned `null`, React would be hydrating markup that
 * does not match what it produced, which is a hydration error, not a tidy
 * removal. So the first client render agrees with the server (button present),
 * and the value is applied in a LAYOUT effect: React flushes that state update
 * synchronously, before the browser paints. The button is therefore never
 * *painted* inside the app, not merely removed a frame later.
 *
 * `useLayoutEffect` does nothing on the server and React warns about it there,
 * so the isomorphic form is used — `useEffect` during SSR, `useLayoutEffect` in
 * the browser. Same body either way.
 *
 * TWO SIGNALS
 *
 * `Capacitor.isNativePlatform()` is the real answer, but it depends on the
 * native bridge object being present on `window` — and on Android the WebView is
 * pointed at the deployed site, so the bridge is injected by the shell rather
 * than by anything this code controls. The shell also sets a user agent
 * (`overrideUserAgent: "WhisperApp/1.0 Android"` in capacitor.config.ts), which
 * is available from the very first tick and cannot be affected by bridge timing.
 * Either signal means "in the app"; every read is guarded, because throwing here
 * would take the landing page down, and "web" is the safe default (worst case,
 * the web build advertises the app, which is exactly right).
 */
const NATIVE_UA_MARKER = "WhisperApp/";

export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;

  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {
    /* No bridge on this page — fall through to the user agent. */
  }

  try {
    return window.navigator.userAgent.includes(NATIVE_UA_MARKER);
  } catch {
    return false;
  }
}

export function useIsNativeApp(): boolean {
  /* `false` matches the server render, so hydration is clean. The layout effect
     then corrects it before the first paint. See above. */
  const [native, setNative] = useState(false);

  useIsomorphicLayoutEffect(() => {
    setNative(isNativeShell());
  }, []);

  return native;
}

/** `useLayoutEffect` in the browser (runs before paint), `useEffect` on the
    server (where a layout effect would warn and do nothing). */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
