// Country -> currency mapping used to price Whisper Coins for every region.
//
// Pricing rule (set by product):
//   - Africa + India ("NGN region"): 100 coins = ₦1,000. Charged to Paystack
//     in NGN; displayed to the buyer converted into their own local currency.
//   - Everywhere else ("USD region"): 100 coins = $1. Charged to Paystack in
//     USD; displayed to the buyer converted into their own local currency.
//
// Paystack itself only settles in NGN, GHS, ZAR, KES and USD, so the charge
// currency is always NGN or USD — the "local currency" numbers below are
// display-only so buyers see a price in something they recognize before their
// card network does the real conversion.

export type CountryInfo = {
  name: string;
  currency: string; // ISO 4217 code
  symbol: string;
  ngnRegion: boolean; // true = Africa or India
};

// --- Africa (all 54 states + Western Sahara) -------------------------------
const AFRICA: Record<string, CountryInfo> = {
  NG: { name: "Nigeria", currency: "NGN", symbol: "₦", ngnRegion: true },
  GH: { name: "Ghana", currency: "GHS", symbol: "₵", ngnRegion: true },
  KE: { name: "Kenya", currency: "KES", symbol: "KSh", ngnRegion: true },
  ZA: { name: "South Africa", currency: "ZAR", symbol: "R", ngnRegion: true },
  EG: { name: "Egypt", currency: "EGP", symbol: "E£", ngnRegion: true },
  ET: { name: "Ethiopia", currency: "ETB", symbol: "Br", ngnRegion: true },
  TZ: { name: "Tanzania", currency: "TZS", symbol: "TSh", ngnRegion: true },
  UG: { name: "Uganda", currency: "UGX", symbol: "USh", ngnRegion: true },
  RW: { name: "Rwanda", currency: "RWF", symbol: "FRw", ngnRegion: true },
  CM: { name: "Cameroon", currency: "XAF", symbol: "FCFA", ngnRegion: true },
  SN: { name: "Senegal", currency: "XOF", symbol: "CFA", ngnRegion: true },
  CI: { name: "Côte d'Ivoire", currency: "XOF", symbol: "CFA", ngnRegion: true },
  MA: { name: "Morocco", currency: "MAD", symbol: "DH", ngnRegion: true },
  DZ: { name: "Algeria", currency: "DZD", symbol: "DA", ngnRegion: true },
  TN: { name: "Tunisia", currency: "TND", symbol: "DT", ngnRegion: true },
  ZM: { name: "Zambia", currency: "ZMW", symbol: "ZK", ngnRegion: true },
  ZW: { name: "Zimbabwe", currency: "ZWG", symbol: "ZiG", ngnRegion: true },
  BW: { name: "Botswana", currency: "BWP", symbol: "P", ngnRegion: true },
  NA: { name: "Namibia", currency: "NAD", symbol: "N$", ngnRegion: true },
  MZ: { name: "Mozambique", currency: "MZN", symbol: "MT", ngnRegion: true },
  AO: { name: "Angola", currency: "AOA", symbol: "Kz", ngnRegion: true },
  CD: { name: "DR Congo", currency: "CDF", symbol: "FC", ngnRegion: true },
  CG: { name: "Congo", currency: "XAF", symbol: "FCFA", ngnRegion: true },
  GA: { name: "Gabon", currency: "XAF", symbol: "FCFA", ngnRegion: true },
  ML: { name: "Mali", currency: "XOF", symbol: "CFA", ngnRegion: true },
  BF: { name: "Burkina Faso", currency: "XOF", symbol: "CFA", ngnRegion: true },
  NE: { name: "Niger", currency: "XOF", symbol: "CFA", ngnRegion: true },
  BJ: { name: "Benin", currency: "XOF", symbol: "CFA", ngnRegion: true },
  TG: { name: "Togo", currency: "XOF", symbol: "CFA", ngnRegion: true },
  GN: { name: "Guinea", currency: "GNF", symbol: "FG", ngnRegion: true },
  SL: { name: "Sierra Leone", currency: "SLE", symbol: "Le", ngnRegion: true },
  LR: { name: "Liberia", currency: "LRD", symbol: "L$", ngnRegion: true },
  GM: { name: "Gambia", currency: "GMD", symbol: "D", ngnRegion: true },
  MW: { name: "Malawi", currency: "MWK", symbol: "MK", ngnRegion: true },
  MU: { name: "Mauritius", currency: "MUR", symbol: "₨", ngnRegion: true },
  SD: { name: "Sudan", currency: "SDG", symbol: "SDG", ngnRegion: true },
  SS: { name: "South Sudan", currency: "SSP", symbol: "£", ngnRegion: true },
  SO: { name: "Somalia", currency: "SOS", symbol: "Sh", ngnRegion: true },
  ER: { name: "Eritrea", currency: "ERN", symbol: "Nfk", ngnRegion: true },
  DJ: { name: "Djibouti", currency: "DJF", symbol: "Fdj", ngnRegion: true },
  LY: { name: "Libya", currency: "LYD", symbol: "LD", ngnRegion: true },
  TD: { name: "Chad", currency: "XAF", symbol: "FCFA", ngnRegion: true },
  CF: { name: "Central African Republic", currency: "XAF", symbol: "FCFA", ngnRegion: true },
  GQ: { name: "Equatorial Guinea", currency: "XAF", symbol: "FCFA", ngnRegion: true },
  CV: { name: "Cabo Verde", currency: "CVE", symbol: "$", ngnRegion: true },
  GW: { name: "Guinea-Bissau", currency: "XOF", symbol: "CFA", ngnRegion: true },
  KM: { name: "Comoros", currency: "KMF", symbol: "CF", ngnRegion: true },
  SZ: { name: "Eswatini", currency: "SZL", symbol: "E", ngnRegion: true },
  LS: { name: "Lesotho", currency: "LSL", symbol: "L", ngnRegion: true },
  MG: { name: "Madagascar", currency: "MGA", symbol: "Ar", ngnRegion: true },
  SC: { name: "Seychelles", currency: "SCR", symbol: "₨", ngnRegion: true },
  BI: { name: "Burundi", currency: "BIF", symbol: "FBu", ngnRegion: true },
  EH: { name: "Western Sahara", currency: "MAD", symbol: "DH", ngnRegion: true },
  ST: { name: "São Tomé and Príncipe", currency: "STN", symbol: "Db", ngnRegion: true },
};

// --- India -------------------------------------------------------------
const INDIA: Record<string, CountryInfo> = {
  IN: { name: "India", currency: "INR", symbol: "₹", ngnRegion: true },
};

// --- Rest of world (USD region) — common local currencies for display ------
const REST_OF_WORLD: Record<string, CountryInfo> = {
  US: { name: "United States", currency: "USD", symbol: "$", ngnRegion: false },
  GB: { name: "United Kingdom", currency: "GBP", symbol: "£", ngnRegion: false },
  IE: { name: "Ireland", currency: "EUR", symbol: "€", ngnRegion: false },
  DE: { name: "Germany", currency: "EUR", symbol: "€", ngnRegion: false },
  FR: { name: "France", currency: "EUR", symbol: "€", ngnRegion: false },
  ES: { name: "Spain", currency: "EUR", symbol: "€", ngnRegion: false },
  IT: { name: "Italy", currency: "EUR", symbol: "€", ngnRegion: false },
  NL: { name: "Netherlands", currency: "EUR", symbol: "€", ngnRegion: false },
  PT: { name: "Portugal", currency: "EUR", symbol: "€", ngnRegion: false },
  BE: { name: "Belgium", currency: "EUR", symbol: "€", ngnRegion: false },
  AT: { name: "Austria", currency: "EUR", symbol: "€", ngnRegion: false },
  FI: { name: "Finland", currency: "EUR", symbol: "€", ngnRegion: false },
  GR: { name: "Greece", currency: "EUR", symbol: "€", ngnRegion: false },
  PL: { name: "Poland", currency: "PLN", symbol: "zł", ngnRegion: false },
  SE: { name: "Sweden", currency: "SEK", symbol: "kr", ngnRegion: false },
  NO: { name: "Norway", currency: "NOK", symbol: "kr", ngnRegion: false },
  DK: { name: "Denmark", currency: "DKK", symbol: "kr", ngnRegion: false },
  CH: { name: "Switzerland", currency: "CHF", symbol: "CHF", ngnRegion: false },
  CA: { name: "Canada", currency: "CAD", symbol: "$", ngnRegion: false },
  AU: { name: "Australia", currency: "AUD", symbol: "$", ngnRegion: false },
  NZ: { name: "New Zealand", currency: "NZD", symbol: "$", ngnRegion: false },
  BR: { name: "Brazil", currency: "BRL", symbol: "R$", ngnRegion: false },
  MX: { name: "Mexico", currency: "MXN", symbol: "$", ngnRegion: false },
  AR: { name: "Argentina", currency: "ARS", symbol: "$", ngnRegion: false },
  CO: { name: "Colombia", currency: "COP", symbol: "$", ngnRegion: false },
  CL: { name: "Chile", currency: "CLP", symbol: "$", ngnRegion: false },
  CN: { name: "China", currency: "CNY", symbol: "¥", ngnRegion: false },
  JP: { name: "Japan", currency: "JPY", symbol: "¥", ngnRegion: false },
  KR: { name: "South Korea", currency: "KRW", symbol: "₩", ngnRegion: false },
  SG: { name: "Singapore", currency: "SGD", symbol: "$", ngnRegion: false },
  MY: { name: "Malaysia", currency: "MYR", symbol: "RM", ngnRegion: false },
  ID: { name: "Indonesia", currency: "IDR", symbol: "Rp", ngnRegion: false },
  PH: { name: "Philippines", currency: "PHP", symbol: "₱", ngnRegion: false },
  VN: { name: "Vietnam", currency: "VND", symbol: "₫", ngnRegion: false },
  TH: { name: "Thailand", currency: "THB", symbol: "฿", ngnRegion: false },
  PK: { name: "Pakistan", currency: "PKR", symbol: "₨", ngnRegion: false },
  BD: { name: "Bangladesh", currency: "BDT", symbol: "৳", ngnRegion: false },
  AE: { name: "United Arab Emirates", currency: "AED", symbol: "د.إ", ngnRegion: false },
  SA: { name: "Saudi Arabia", currency: "SAR", symbol: "﷼", ngnRegion: false },
  IL: { name: "Israel", currency: "ILS", symbol: "₪", ngnRegion: false },
  TR: { name: "Türkiye", currency: "TRY", symbol: "₺", ngnRegion: false },
  RU: { name: "Russia", currency: "RUB", symbol: "₽", ngnRegion: false },
};

export const COUNTRY_CURRENCY: Record<string, CountryInfo> = {
  ...AFRICA,
  ...INDIA,
  ...REST_OF_WORLD,
};

export const DEFAULT_NGN_REGION_COUNTRY: CountryInfo = COUNTRY_CURRENCY.NG;
export const DEFAULT_USD_REGION_COUNTRY: CountryInfo = COUNTRY_CURRENCY.US;

export function getCountryInfo(countryCode: string | null | undefined): CountryInfo {
  if (!countryCode) return DEFAULT_USD_REGION_COUNTRY;
  const info = COUNTRY_CURRENCY[countryCode.toUpperCase()];
  return info ?? DEFAULT_USD_REGION_COUNTRY;
}

// Fallback FX rates (units of currency per 1 USD) used only if the live rate
// lookup in /api/currency/rates fails. These are rough estimates and get
// overwritten by the live provider whenever it's reachable.
export const FALLBACK_RATES_PER_USD: Record<string, number> = {
  USD: 1,
  NGN: 1550,
  GHS: 15.5,
  KES: 129,
  ZAR: 18.3,
  EGP: 50,
  ETB: 123,
  TZS: 2600,
  UGX: 3700,
  RWF: 1300,
  XAF: 605,
  XOF: 605,
  MAD: 9.9,
  DZD: 134,
  TND: 3.1,
  ZMW: 27,
  ZWG: 13.8,
  BWP: 13.5,
  NAD: 18.3,
  MZN: 64,
  AOA: 920,
  CDF: 2800,
  GNF: 8600,
  SLE: 22.7,
  LRD: 190,
  GMD: 72,
  MWK: 1740,
  MUR: 46,
  SDG: 600,
  SSP: 1800,
  SOS: 570,
  ERN: 15,
  DJF: 177.7,
  LYD: 4.85,
  CVE: 101,
  KMF: 440,
  SZL: 18.3,
  LSL: 18.3,
  MGA: 4500,
  SCR: 14.5,
  BIF: 2950,
  STN: 22.3,
  INR: 86.5,
  GBP: 0.78,
  EUR: 0.92,
  PLN: 3.95,
  SEK: 10.3,
  NOK: 10.6,
  DKK: 6.85,
  CHF: 0.81,
  CAD: 1.38,
  AUD: 1.53,
  NZD: 1.66,
  BRL: 5.7,
  MXN: 18.6,
  ARS: 1220,
  COP: 4100,
  CLP: 970,
  CNY: 7.25,
  JPY: 148,
  KRW: 1380,
  SGD: 1.34,
  MYR: 4.4,
  IDR: 16200,
  PHP: 58.5,
  VND: 25500,
  THB: 34.5,
  PKR: 279,
  BDT: 122,
  AED: 3.6725,
  SAR: 3.75,
  ILS: 3.7,
  TRY: 39,
  RUB: 92,
};

/**
 * Convert an amount denominated in NGN or USD into the buyer's local
 * currency for display purposes only (the actual Paystack charge always
 * happens in NGN or USD).
 */
export function convertForDisplay(
  amount: number,
  fromCurrency: "NGN" | "USD",
  toCurrency: string,
  ratesPerUsd: Record<string, number>
): number {
  const fromRatePerUsd = ratesPerUsd[fromCurrency] ?? FALLBACK_RATES_PER_USD[fromCurrency] ?? 1;
  const toRatePerUsd = ratesPerUsd[toCurrency] ?? FALLBACK_RATES_PER_USD[toCurrency] ?? fromRatePerUsd;
  const usdAmount = amount / fromRatePerUsd;
  return usdAmount * toRatePerUsd;
}
// Shared live-FX cache used by both /api/currency/rates (display prices) and
// /api/paystack/verify (server-side charge validation), so both places agree
// on the same numbers. Refreshes every 6 hours, falls back to the hardcoded
// table above if the provider is unreachable.
const RATES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let ratesCache: { rates: Record<string, number>; source: "live" | "fallback"; fetchedAt: number } | null = null;

export async function getLiveRatesPerUsd(): Promise<{
  rates: Record<string, number>;
  source: "live" | "fallback";
  fetchedAt: number;
}> {
  const now = Date.now();

  if (ratesCache && now - ratesCache.fetchedAt < RATES_CACHE_TTL_MS) {
    return ratesCache;
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      next: { revalidate: 21600 },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.result === "success" && data?.rates) {
        ratesCache = { rates: data.rates as Record<string, number>, source: "live", fetchedAt: now };
        return ratesCache;
      }
    }
  } catch {
    // fall through to fallback/stale cache below
  }

  if (!ratesCache) {
    ratesCache = { rates: FALLBACK_RATES_PER_USD, source: "fallback", fetchedAt: now };
  }
  return ratesCache;
}
export function formatLocalAmount(amount: number, symbol: string): string {
  // Currencies with very large unit counts (e.g. IDR, VND, UGX) read better
  // rounded to whole numbers; everything else gets 2 decimal places.
  const wholeNumberOnly = amount >= 1000 || amount === Math.round(amount);
  const formatted = wholeNumberOnly
    ? Math.round(amount).toLocaleString()
    : amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${formatted}`;
}