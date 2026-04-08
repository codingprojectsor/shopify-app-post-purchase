const isProduction = process.env.NODE_ENV === "production";

export function getAppUrl(): string {
  return isProduction
    ? (process.env.SHOPIFY_APP_URL_PRODUCTION || process.env.SHOPIFY_APP_URL || "")
    : (process.env.SHOPIFY_APP_URL || "");
}

export function isProd(): boolean {
  return isProduction;
}
