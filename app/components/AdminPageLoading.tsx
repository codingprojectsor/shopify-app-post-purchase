import { Spinner, BlockStack, Text } from "@shopify/polaris";

interface AdminPageLoadingProps {
  text?: string;
}

export function AdminPageLoading({ text = "Loading..." }: AdminPageLoadingProps) {
  return (
    <div style={{ padding: "48px", textAlign: "center" }}>
      <BlockStack gap="300" inlineAlign="center">
        <Spinner size="large" />
        <Text as="p" tone="subdued">{text}</Text>
      </BlockStack>
    </div>
  );
}
