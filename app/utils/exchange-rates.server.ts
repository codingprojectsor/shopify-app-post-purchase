import { logger } from "./logger.server";

const log = logger.for("exchange-rates");

interface RateCache {
  rates: Record<string, number>; // currency -> 1 USD = X currency
  fetchedAt: number;
}

let cache: RateCache | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch exchange rates from frankfurter.app (free, no API key).
 * Returns rates relative to USD: { EUR: 0.92, GBP: 0.79, INR: 83.5, ... }
 */
async function fetchRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache.rates;
  }

  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rates: Record<string, number> = { USD: 1, ...data.rates };
    cache = { rates, fetchedAt: Date.now() };
    log.info("Exchange rates fetched", { count: Object.keys(rates).length });
    return rates;
  } catch (err) {
    log.error("Failed to fetch exchange rates", err);
    // Return cached rates if available, otherwise just USD
    return cache?.rates || { USD: 1 };
  }
}

/**
 * Convert an amount from a source currency to USD.
 * Returns the USD equivalent.
 */
export async function convertToUSD(amount: number, fromCurrency: string): Promise<number> {
  if (fromCurrency === "USD" || !fromCurrency) return amount;

  const rates = await fetchRates();
  const rate = rates[fromCurrency];

  if (!rate) {
    log.warn(`Unknown currency: ${fromCurrency}, treating as USD`);
    return amount;
  }

  // rate = how many units of fromCurrency per 1 USD
  // so USD = amount / rate
  return amount / rate;
}

/**
 * Get the exchange rate for a currency relative to USD.
 * Returns null if currency not found.
 */
export async function getUSDRate(currency: string): Promise<number | null> {
  if (currency === "USD") return 1;
  const rates = await fetchRates();
  return rates[currency] || null;
}
