interface EmptyStateProps {
  icon: string;
  heading: string;
  description: string;
  features?: { icon: string; label: string }[];
  children?: React.ReactNode;
}

export function EmptyState({ icon, heading, description, features, children }: EmptyStateProps) {
  return (
    <s-box padding="large-200" borderWidth="base" borderRadius="large">
      <s-stack gap="large" alignItems="center">
        <s-box padding="base" borderRadius="large" background="subdued">
          <s-icon type={icon as any} />
        </s-box>
        <s-stack gap="base" alignItems="center">
          <s-text type="strong">{heading}</s-text>
          <s-paragraph color="subdued">{description}</s-paragraph>
        </s-stack>
        {features && features.length > 0 && (
          <s-stack direction="inline" gap="large">
            {features.map((f, i) => (
              <s-stack key={i} direction="inline" gap="small-100" alignItems="center">
                <s-icon type={f.icon as any} color="subdued" size="small" />
                <s-text color="subdued">{f.label}</s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
        {children}
      </s-stack>
    </s-box>
  );
}
