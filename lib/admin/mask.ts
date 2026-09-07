/**
 * Masking for the two fields on the platform that identify a person outside it.
 *
 * Applied server-side, in the route, rather than in the component. A value that
 * reaches the browser in full can be read in full — from React DevTools, from a
 * network response, from a screenshot — so "the table only renders the masked
 * one" is a rendering decision, not a privacy guarantee. The list endpoint
 * never sends the unmasked value at all; the detail endpoint does, once, for the
 * account the admin actually opened, and that call is audited.
 */

/** `08031234567` → `0803•••4567`. Recognisable, not usable. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 4)}•••${digits.slice(-3)}`;
}

/** `someone@gmail.com` → `s••••@gmail.com`. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 1) return email;
  return `${email[0]}••••${email.slice(at)}`;
}
