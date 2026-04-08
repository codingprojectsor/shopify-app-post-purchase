interface PageLoadingProps {
  text?: string;
}

export function PageLoading({ text = "Loading..." }: PageLoadingProps) {
  return (
    <s-box padding="large-200">
      <s-stack gap="base" alignItems="center">
        <s-spinner size="large" />
        <s-text color="subdued">{text}</s-text>
      </s-stack>
    </s-box>
  );
}
