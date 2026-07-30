export const HINT_UNLOCK_COST = 5;
export const UNLOCK_CHAT_COST = 40;
export const SEND_IMAGE_COST = 20;

// Base pricing (before local-currency conversion):
//   Africa + India -> priced in NGN, 100 coins = ₦1,000
//   Everywhere else -> priced in USD, 100 coins = $1
export const NGN_PER_100_COINS = 1000;
export const USD_PER_100_COINS = 1;

export type CoinPackage = {
  coins: number;
  label: string;
  ngnAmount: number; // whole naira, charge currency for the NGN region
  usdAmount: number; // whole dollars, charge currency for the USD region
  popular?: boolean;
};

export const COIN_PACKAGES: CoinPackage[] = [
  { coins: 100, label: "Starter Pack", ngnAmount: 1000, usdAmount: 1 },
  { coins: 300, label: "Whisper Bundle", ngnAmount: 3000, usdAmount: 3, popular: true },
  { coins: 500, label: "Whisper Vault", ngnAmount: 5000, usdAmount: 5 },
  { coins: 1000, label: "Whisper Fortune", ngnAmount: 10000, usdAmount: 10 },
];

export function sanitizeGmailName(email?: string | null) {
  if (!email) return null;
  const firstPart = email.toLowerCase().split("@gmail.com")[0] ?? "";
  const lettersOnly = firstPart.replace(/[^a-z]/g, "");
  return lettersOnly || null;
}