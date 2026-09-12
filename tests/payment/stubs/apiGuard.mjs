/** Double for @/lib/apiGuard: the limiter lets everything through, and the
    IP is a constant — the payments test is about the credit path, not
    throttling (the guards are their own tests). */
export function clientIp() {
  return "10.0.0.1";
}

export async function consume() {
  return null;
}

export async function consumeMulti() {
  return null;
}

export function rateLimitedResponse() {
  return new Response("rate limited", { status: 429 });
}
