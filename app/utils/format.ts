/**
 * Currency formatting utilities.
 *
 * Merchant-facing: use the shop's currency (passed from Shopify).
 * Admin/billing: defaults to USD.
 */

const DEFAULT_CURRENCY = "USD";

export function formatCurrency(amount: number, currencyCode = DEFAULT_CURRENCY): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if currency code is invalid
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

export function formatPrice(amount: number, currencyCode = DEFAULT_CURRENCY): string {
  return formatCurrency(amount, currencyCode);
}

export function formatPlanPrice(price: number, suffix = "/mo", currencyCode = DEFAULT_CURRENCY): string {
  if (price === 0) return "Free";
  return `${formatCurrency(price, currencyCode)}${suffix}`;
}

export function formatDiscount(type: string, value: number, currencyCode = DEFAULT_CURRENCY): string {
  return type === "percentage"
    ? `${value}% off`
    : `${formatCurrency(value, currencyCode)} off`;
}

export function formatDiscountShort(type: string, value: number, currencyCode = DEFAULT_CURRENCY): string {
  return type === "percentage"
    ? `${value}%`
    : formatCurrency(value, currencyCode);
}

export { DEFAULT_CURRENCY };
