/** Double for @/lib/currency: a fixed FX feed so amount validation is
    deterministic (no live API in the test, and the test knows exactly
    which NGN rate the rules were checked against). */
export const getLiveRatesPerUsd = async () => ({
  rates: { NGN: 1600 },
  source: "fixed",
  fetchedAt: Date.now(),
});
