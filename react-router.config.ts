import type { Config } from "@react-router/dev/config";

export default {
  allowedActionOrigins: [
    "admin.shopify.com",
    "*.myshopify.com",
    "*.devtunnels.ms",
    "*.devtunnels.ms:3000",
    "localhost:3000",
  ],
} satisfies Config;
