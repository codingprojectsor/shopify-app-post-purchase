import { useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

type ToastMap = Record<string, string | ((data: any) => string)>;

/**
 * Shows Shopify toast notifications based on fetcher action results.
 */
export function useToast(
  fetcher: { state: string; data: unknown },
  toastMap: ToastMap,
  onSuccess?: (data: any) => void,
) {
  const shopify = useAppBridge();
  const toastMapRef = useRef(toastMap);
  const onSuccessRef = useRef(onSuccess);
  toastMapRef.current = toastMap;
  onSuccessRef.current = onSuccess;

  // Track the last data we processed to avoid double-firing
  const lastProcessedRef = useRef<unknown>(null);

  useEffect(() => {
    if (fetcher.state !== "idle") return;
    if (!fetcher.data || typeof fetcher.data !== "object") return;
    if (fetcher.data === lastProcessedRef.current) return;

    lastProcessedRef.current = fetcher.data;
    const data = fetcher.data as Record<string, unknown>;

    for (const [key, messageOrFn] of Object.entries(toastMapRef.current)) {
      if (key in data) {
        const message = typeof messageOrFn === "function" ? messageOrFn(data) : messageOrFn;
        if (message) shopify.toast.show(message);
        if (key !== "error" && onSuccessRef.current) onSuccessRef.current(data);
        return;
      }
    }
  }, [fetcher.state, fetcher.data, shopify]);
}
