/**
 * Double for lib/offline.ts. The real module imports @capacitor/network, which
 * has no meaning outside the native shell. The call engine only ever asks
 * `requireOnline`, so that is all this provides — and it defaults to online,
 * because the harness is testing the call, not the connectivity banner.
 */
let online = true;

export function setHarnessOnline(next) {
  online = next;
}

export function isOnline() {
  return online;
}

export function requireOnline(notify, action = "That") {
  if (online) return true;
  notify(`${action} needs a connection. You're offline right now.`);
  return false;
}

export function subscribeToConnectivity() {
  return () => {};
}
