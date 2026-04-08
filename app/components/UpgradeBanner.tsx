interface UpgradeBannerProps {
  feature: string;
  currentPlan: string;
}

export function UpgradeBanner({ feature, currentPlan }: UpgradeBannerProps) {
  return (
    <s-banner tone="warning">
      <s-stack gap="small-200">
        <s-text type="strong">{feature} is not available on your {currentPlan} plan</s-text>
        <s-text color="subdued">Upgrade your plan to unlock this feature.</s-text>
        <s-button variant="primary" onClick={() => window.location.href = "/app/pricing"}>
          View plans
        </s-button>
      </s-stack>
    </s-banner>
  );
}
