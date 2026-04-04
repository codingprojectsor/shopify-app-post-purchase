/// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    SHOPIFY_API_KEY: string;
    SHOPIFY_API_SECRET: string;
    SHOPIFY_APP_URL: string;
    SCOPES: string;
    ADMIN_SECRET?: string;
  }
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
