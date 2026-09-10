/** Browser push-service hosts only. User-supplied subscriptions must not turn
 * the privileged notification sender into an arbitrary HTTP client (SSRF).
 */
export function isTrustedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    return url.hostname === "fcm.googleapis.com"
      || url.hostname === "updates.push.services.mozilla.com"
      || url.hostname.endsWith(".push.services.mozilla.com")
      || url.hostname === "web.push.apple.com"
      || url.hostname.endsWith(".notify.windows.com");
  } catch {
    return false;
  }
}
