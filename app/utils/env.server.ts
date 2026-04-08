const isDev = process.env.NODE_ENV !== "production";

export function getAppUrl(): string {
  if (isDev && process.env.SHOPIFY_APP_URL_DEV) {
    return process.env.SHOPIFY_APP_URL_DEV;
  }
  return process.env.SHOPIFY_APP_URL || "";
}

export function isProd(): boolean {
  return !isDev;
}
