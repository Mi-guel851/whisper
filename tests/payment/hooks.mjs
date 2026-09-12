/**
 * Module-resolution hooks for the payments test.
 *
 * Same bridge as tests/harness/hooks.mjs — Node 22 strips types from .ts
 * natively, and `@/` comes from tsconfig.json — plus test doubles for the
 * three modules that talk to the outside world: Supabase (an in-memory
 * ledger that mirrors credit_verified_payment's replay semantics exactly),
 * the durable rate limiter, and the FX rate feed. Everything else — the
 * webhook route, the verify route, the shared settlement chain, the
 * signature verifier — is the shipped source, unmodified.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

/** Modules replaced by doubles, keyed by the specifier the app uses. */
const STUBS = {
  "@supabase/supabase-js": path.join(HERE, "stubs", "supabase.mjs"),
  "@/lib/apiGuard": path.join(HERE, "stubs", "apiGuard.mjs"),
  "@/lib/currency": path.join(HERE, "stubs", "currency.mjs"),
  "next/server": path.join(HERE, "stubs", "next-server.mjs"),
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
