import { AppProvider, Frame } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";

export function AdminPolarisProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider i18n={enTranslations}>
      <Frame>{children}</Frame>
    </AppProvider>
  );
}
