"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Marks the document when Whisper is running inside the Capacitor shell rather
 * than a browser tab, so CSS can charge the two environments differently.
 *
 * WHY THIS IS WORTH A COMPONENT
 *
 * The app and the site run the exact same bundle from the exact same URL — the
 * shell is a WebView pointed at the deployment — so anything that makes the app
 * feel slower than the site is either the network or the WebView itself. The
 * WebView half is real and measurable: Android's WebView composites
 * `backdrop-filter` far slower than desktop Chrome at a fraction of the fill
 * rate, and it latches `:hover` after every tap because a finger never leaves an
 * element.
 *
 * Media queries already cover the second problem (`hover: hover`). Nothing in CSS
 * can detect the first, because "is this a WebView" is not a media feature — hence
 * an attribute. Rules keyed off `[data-native="true"]` reduce blur radii on the
 * surfaces that re-composite during a scroll; see the note beside
 * `.feed-tabs-wrap` in globals.css.
 *
 * Set on `<html>` rather than `<body>` so a rule can key off it without needing
 * the element to be inside the React tree, and set in an effect because
 * `Capacitor.isNativePlatform()` reads a global the native runtime injects at
 * startup — it is not knowable during the server render, and guessing from a
 * user-agent string would be wrong in both directions.
 */
export default function NativeShell() {
  useEffect(() => {
    const root = document.documentElement;

    /* Synchronous — no bridge round trip, so this lands in the first commit
       rather than a frame or two into the session where it would cause a
       visible re-blur. */
    const native = Capacitor.isNativePlatform();
    if (!native) return;

    root.dataset.native = "true";
    root.dataset.nativePlatform = Capacitor.getPlatform();

    return () => {
      delete root.dataset.native;
      delete root.dataset.nativePlatform;
    };
  }, []);

  return null;
}
