interface StatsCardProps {
  icon: string;
  label: string;
  value: string;
  subtitle?: string;
}

export function StatsCard({ icon, label, value, subtitle }: StatsCardProps) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="large">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type={icon as any} color="subdued" size="small" />
          <s-text color="subdued">{label}</s-text>
        </s-stack>
        <s-text type="strong" fontVariantNumeric="tabular-nums">
          {value}
        </s-text>
        {subtitle && <s-text color="subdued">{subtitle}</s-text>}
      </s-stack>
    </s-box>
  );
}
