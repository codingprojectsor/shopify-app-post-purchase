/// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    SHOPIFY_API_KEY: string;
    SHOPIFY_API_SECRET: string;
    SHOPIFY_APP_URL: string;
    SHOPIFY_APP_URL_PRODUCTION?: string;
    SCOPES: string;
    SESSION_SECRET?: string;
    DATABASE_URL_PRODUCTION?: string;
  }
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
