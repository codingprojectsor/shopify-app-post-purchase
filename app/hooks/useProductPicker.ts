import { useCallback } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { createClientLogger } from "../utils/client-logger";

const log = createClientLogger("useProductPicker");

export interface SelectedProduct {
  productId: string;
  variantId: string;
  productTitle: string;
  productImage: string;
  productPrice: string;
}

export function useProductPicker() {
  const shopify = useAppBridge();

  const pickProduct = useCallback(async (): Promise<SelectedProduct | null> => {
    try {
      const selected = await (shopify as any).resourcePicker({
        type: "product",
        multiple: false,
        action: "select",
      });
      if (selected && selected.length > 0) {
        const product = selected[0];
        const variant = product.variants?.[0];
        return {
          productId: product.id,
          variantId: variant?.id || "",
          productTitle: product.title,
          productImage: product.images?.[0]?.originalSrc || "",
          productPrice: variant?.price || "0.00",
        };
      }
    } catch (err) {
      log.error("Product picker failed", err);
    }
    return null;
  }, [shopify]);

  const pickProductForRule = useCallback(async (): Promise<{ id: string; title: string } | null> => {
    try {
      const selected = await (shopify as any).resourcePicker({
        type: "product",
        multiple: false,
        action: "select",
      });
      if (selected && selected.length > 0) {
        return { id: selected[0].id, title: selected[0].title };
      }
    } catch (err) {
      log.error("Product picker for rule failed", err);
    }
    return null;
  }, [shopify]);

  return { pickProduct, pickProductForRule };
}
