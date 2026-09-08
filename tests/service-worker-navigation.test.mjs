/*
 * Regression guard for the service worker's navigation fallback chain.
 *
 * Runs public/sw.js inside a mock ServiceWorkerGlobalScope (fake CacheStorage,
 * controllable network) and asserts the behaviours that the "Reconnecting"
 * dead-end bug violated: a slow or dead server must restore the last-visit
 * snapshot, never the ghost page, and a connected-but-slow navigation must be
 * allowed to finish rather than be replaced.
 *
 * Dependency-free on purpose: `npm test` (or `node tests/service-worker-navigation.test.mjs`)
 * is the whole test setup this repo needs for the worker.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "https://whisper.test";

/* ---- network behaviour table ---- */
let netBehavior = (url) => new Response("LIVE " + new URL(url).pathname, { status: 200 });
function setNet(fn) { netBehavior = fn; }
const HANG = () => new Promise(() => {});
const ERR = () => Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED"));

function mockFetch(reqOrUrl, init) {
  const url = typeof reqOrUrl === "string" ? reqOrUrl : reqOrUrl.url;
  return Promise.resolve().then(() => netBehavior(url, init));
}

/* Workers resolve relative Request URLs against the worker location; Node does not. */
class WRequest extends Request {
  constructor(input, init = {}) {
    const { mode, ...rest } = init;
    super(typeof input === "string" && input.startsWith("/") ? ORIGIN + input : input, rest);
    /* undici forbids constructing client Requests with mode "navigate"; the
       worker only ever reads it, so shadow the prototype getter. */
    if (mode) Object.defineProperty(this, "mode", { value: mode });
  }
}

/* ---- mock Cache / CacheStorage ---- */
const strip = (u) => u.split("?")[0].split("#")[0];
class MockCache {
  constructor() { this.map = new Map(); }
  async match(reqOrUrl, opts = {}) {
    const url = strip(typeof reqOrUrl === "string" ? reqOrUrl : reqOrUrl.url);
    if (this.map.has(url)) return this.map.get(url).clone();
    if (opts.ignoreSearch) {
      for (const [k, v] of this.map) if (strip(k) === url) return v.clone();
    }
    return undefined;
  }
  async put(req, res) { this.map.set(strip(typeof req === "string" ? req : req.url), res); }
  async delete(req) { return this.map.delete(strip(typeof req === "string" ? req : req.url)); }
  async keys() { return [...this.map.keys()].map((u) => new WRequest(u)); }
  async add(req) {
    const res = await mockFetch(req);
    if (!res.ok) throw new Error("add failed: " + res.status);
    await this.put(req, res);
  }
}
const store = new Map();
const caches = {
  async open(name) { if (!store.has(name)) store.set(name, new MockCache()); return store.get(name); },
  async keys() { return [...store.keys()]; },
  async delete(name) { return store.delete(name); },
};

/* ---- fake global scope ---- */
const listeners = new Map();
const self = {
  location: new URL(ORIGIN + "/sw.js"),
  addEventListener: (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  },
  skipWaiting: async () => {},
  clients: { claim: async () => {}, matchAll: async () => [] },
};

const context = vm.createContext({
  self,
  caches,
  fetch: mockFetch,
  Request: WRequest,
  Response,
  Headers,
  URL,
  setTimeout,
  clearTimeout,
  console,
  Promise,
  Date,
  Number,
  String,
  Object,
  Array,
  Math,
  JSON,
  AbortController,
});

vm.runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context);

function fire(type, event) {
  for (const fn of listeners.get(type) || []) fn(event);
  return event;
}

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); }
}

async function responseFor(path) {
  let captured;
  const event = { request: new WRequest(path, { mode: "navigate" }), respondWith: (p) => { captured = p; } };
  fire("fetch", event);
  return captured;
}

const run = async () => {
  console.log("install");
  let installP;
  fire("install", { waitUntil: (p) => { installP = p; } });
  await installP;

  console.log("scenario 1: live network answers inside the deadline");
  setNet((url) => new Response("LIVE " + new URL(url).pathname, { status: 200 }));
  let res = await responseFor("/inbox");
  check("serves the live document", (await res.text()).includes("LIVE /inbox"));

  console.log("scenario 2: slow server restores the last-visit snapshot");
  const inboxHtml = "<!DOCTYPE html>\n<html><head></head><body><main>INBOX PREVIEW MARKER</main></body></html>";
  let msgP;
  fire("message", {
    data: { type: "save-snapshot", path: "/inbox", html: inboxHtml, at: Date.now() },
    waitUntil: (p) => { msgP = p; },
  });
  await msgP;

  setNet(HANG);
  const started = Date.now();
  res = await responseFor("/inbox");
  const body = await res.text();
  check("serves the snapshot, not a dead end", body.includes("INBOX PREVIEW MARKER"), body.slice(0, 120));
  check("snapshot carries the restore note", body.includes("data-sw-restore-note") && body.includes("Your last visit"));
  check("snapshot carries the auto-refresh probe", body.includes("location.reload()"));
  check("answered near the 2.5s deadline, not later", Date.now() - started < 4000, String(Date.now() - started) + "ms");
  check("no Reconnecting ghost page anywhere", !body.includes("Reconnecting"));

  console.log("scenario 3: unknown route falls back to the newest snapshot");
  res = await responseFor("/chat/abc");
  check("newest snapshot served for an uncached route", (await res.text()).includes("INBOX PREVIEW MARKER"));

  console.log("scenario 4: hard network error still restores the snapshot");
  setNet(ERR);
  res = await responseFor("/inbox");
  check("snapshot served on network error", (await res.text()).includes("INBOX PREVIEW MARKER"));

  console.log("scenario 5: no snapshots -> precached shell document");
  await caches.delete("whisper-snapshot-v1");
  setNet(ERR);
  res = await responseFor("/signup");
  const shellBody = await res.text();
  check("precached /signup shell is the floor when the network is dead", shellBody === "LIVE /signup", shellBody.slice(0, 80));

  console.log("scenario 6: cacheless route with a slow-but-live server waits, never ghosts");
  setNet((url) => new Promise((r) => setTimeout(() => r(new Response("LIVE " + new URL(url).pathname, { status: 200 })), 3200)));
  res = await responseFor("/never-cached");
  check("eventually serves the live page", (await res.text()).includes("LIVE /never-cached"));

  console.log("scenario 7: cacheless + dead network rejects (browser's own error page)");
  setNet(ERR);
  let rejected = false;
  try { await responseFor("/totally-unknown"); } catch { rejected = true; }
  check("rejects instead of showing a fake page", rejected);

  console.log("scenario 8: sign-out clears snapshots");
  let saveP;
  fire("message", { data: { type: "save-snapshot", path: "/x", html: inboxHtml, at: Date.now() }, waitUntil: (p) => { saveP = p; } });
  await saveP;
  let clearP;
  fire("message", { data: { type: "clear-snapshots" }, waitUntil: (p) => { clearP = p; } });
  await clearP;
  check("snapshot cache dropped", !(await caches.keys()).includes("whisper-snapshot-v1"));

  console.log("scenario 9: ghost page absent from the shell cache");
  const shell = await caches.open("whisper-shell-v6");
  check("offline.html not precached", (await shell.match(new WRequest("/offline.html"))) === undefined);

  console.log(failures === 0 ? "\nALL SCENARIOS PASSED" : `\n${failures} SCENARIO(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(1); });
