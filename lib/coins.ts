export const REVEAL_SENDER_COST = 40;
export const UNLOCK_CHAT_COST = 20;

export const COIN_PACKAGES = [
  { coins: 100, label: "Starter Glow" },
  { coins: 250, label: "Most Popular", popular: true },
  { coins: 600, label: "Power Wallet" },
  { coins: 1500, label: "Whisper Vault" },
];

export function sanitizeGmailName(email?: string | null) {
  if (!email) return null;
  const firstPart = email.toLowerCase().split("@gmail.com")[0] ?? "";
  const lettersOnly = firstPart.replace(/[^a-z]/g, "");
  return lettersOnly || null;
}
