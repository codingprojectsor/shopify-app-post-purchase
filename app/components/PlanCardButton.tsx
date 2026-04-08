import { useFetcher } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

interface PlanCardButtonProps {
  planSlug: string;
  isCurrent: boolean;
  isCancelled: boolean;
  isFree: boolean;
  isDowngrade: boolean;
  trialDays: number;
  periodEndDate: string | null;
  currentPlanSlug: string;
}

export function PlanCardButton({
  planSlug, isCurrent, isCancelled, isFree, isDowngrade, trialDays, periodEndDate, currentPlanSlug,
}: PlanCardButtonProps) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || typeof fetcher.data !== "object") return;
    const data = fetcher.data as any;
    if (data.confirmationUrl) {
      window.open(data.confirmationUrl, "_top");
    }
    if (data.cancelled) {
      shopify.toast.show("Subscription cancelled");
    }
    if (data.error) {
      shopify.toast.show(data.error);
    }
  }, [fetcher.state, fetcher.data, shopify]);

  if (isCurrent && !isCancelled) {
    return (
      <s-stack gap="small-200">
        <s-button variant="secondary" disabled>Current plan</s-button>
        {!isFree && (
          <s-button
            variant="tertiary"
            loading={isLoading || undefined}
            onClick={() => fetcher.submit({ intent: "cancel" }, { method: "POST" })}
          >
            Cancel subscription
          </s-button>
        )}
      </s-stack>
    );
  }

  if (isCurrent && isCancelled) {
    return (
      <s-stack gap="small-200">
        <s-button
          variant="primary"
          loading={isLoading || undefined}
          onClick={() => fetcher.submit({ intent: "subscribe", plan: planSlug }, { method: "POST" })}
        >
          Re-subscribe
        </s-button>
        {periodEndDate && <s-text color="subdued">Access until {periodEndDate}</s-text>}
      </s-stack>
    );
  }

  if (isFree) {
    return (
      <s-button variant="secondary">
        {currentPlanSlug === "free" && !isCancelled ? "Current plan" : "Downgrade to Free"}
      </s-button>
    );
  }

  return (
    <s-button
      variant="primary"
      loading={isLoading || undefined}
      onClick={() => fetcher.submit({ intent: "subscribe", plan: planSlug }, { method: "POST" })}
    >
      {isDowngrade ? "Downgrade" : trialDays > 0 ? "Start free trial" : "Subscribe"}
    </s-button>
  );
}
