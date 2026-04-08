import { useOutletContext } from "react-router";

interface AppContext {
  currency: string;
}

export function useShopCurrency(): string {
  try {
    const context = useOutletContext<AppContext>();
    return context?.currency || "USD";
  } catch {
    return "USD";
  }
}
