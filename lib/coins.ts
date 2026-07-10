export const REVEAL_SENDER_COST = 40;
export const UNLOCK_CHAT_COST = 20;

export const COIN_PACKAGES = [
  { coins: 2000, label: "Whisper Vault" },
];

export function sanitizeGmailName(email?: string | null) {
  if (!email) return null;
  const firstPart = email.toLowerCase().split("@gmail.com")[0] ?? "";
  const lettersOnly = firstPart.replace(/[^a-z]/g, "");
  return lettersOnly || null;
}
