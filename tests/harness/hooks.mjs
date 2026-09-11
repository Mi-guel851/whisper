/**
 * Module-resolution hooks for running the app's real TypeScript modules under
 * Node (see tests/call-two-users.test.mjs).
 *
 * Node 22 strips types from .ts files natively, but it will not invent file
 * extensions and it knows nothing about the `@/` path alias in tsconfig.json.
 * These two hooks are the whole bridge:
 *
 *   * `@/lib/calls/callSession` -> <repo>/lib/calls/callSession.ts
 *   * `./signaling`             -> ./signaling.ts
 *   * three side-effectful modules are redirected onto test doubles, because
 *     the real ones talk to Capacitor, the Web Audio API and a live Supabase
 *     project (see tests/harness/stubs).
 *
 * Everything else — the call engine, the signaling manager, the ICE server
 * resolver — is the shipped source, unmodified.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

/** Modules replaced by doubles, keyed by the specifier the app uses. */
const STUBS = {
  "@/lib/offline": path.join(HERE, "stubs", "offline.mjs"),
  "@/lib/haptics": path.join(HERE, "stubs", "haptics.mjs"),
  "@/lib/supabase/client": path.join(HERE, "stubs", "supabase.mjs"),
};

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) {
    return { url: pathToFileURL(STUBS[specifier]).href, shortCircuit: true };
  }

  if (specifier.startsWith("@/")) {
    const base = path.join(REPO, specifier.slice(2));
    const resolved = withExtension(base);
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : REPO;
    const base = path.resolve(path.dirname(parentPath), specifier);
    const resolved = withExtension(base);
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}

function withExtension(base) {
  if (existsSync(base)) {
    const stat = statSync(base);
    if (stat.isFile()) return base;
    for (const ext of [".ts", ".mjs", ".js"]) {
      if (existsSync(path.join(base, "index" + ext))) return path.join(base, "index" + ext);
    }
    return null;
  }
  for (const ext of [".ts", ".mts", ".mjs", ".js"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}
