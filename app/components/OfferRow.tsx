import { useCallback } from "react";
import { useFetcher } from "react-router";
import type { OfferSummary } from "../types/offers";
import { formatDiscount, formatPrice } from "../utils/format";

interface OfferRowProps {
  offer: OfferSummary;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  currency?: string;
}

export function OfferRow({ offer, onEdit, onDelete, onDuplicate, currency = "USD" }: OfferRowProps) {
  const toggleFetcher = useFetcher();
  const isToggling = toggleFetcher.state !== "idle";
  const discountLabel = formatDiscount(offer.discountType, offer.discountValue, currency);

  const handleToggle = useCallback(() => {
    toggleFetcher.submit(
      {
        intent: "toggle",
        offerId: offer.id,
        enabled: offer.enabled ? "false" : "true",
      },
      { method: "POST" },
    );
  }, [toggleFetcher, offer.id, offer.enabled]);

  return (
    <s-table-row>
      {/* Offer info */}
      <s-table-cell>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          {offer.productImage ? (
            <s-thumbnail src={offer.productImage} alt={offer.productTitle} size="small-200" />
          ) : (
            <s-box padding="small-200" borderRadius="base" background="subdued">
              <s-icon type="product" color="subdued" size="small" />
            </s-box>
          )}
          <s-stack gap="small-100">
            <s-text type="strong">{offer.title}</s-text>
            <s-text color="subdued">{offer.productTitle}</s-text>
          </s-stack>
        </s-stack>
      </s-table-cell>

      {/* Status */}
      <s-table-cell>
        <s-stack gap="small-100">
          <s-stack direction="inline" gap="small-100">
            <s-switch
              checked={offer.enabled}
              onChange={handleToggle}
              label={offer.enabled ? "Active" : "Off"}
              labelAccessibilityVisibility="exclusive"
              disabled={isToggling || undefined}
            />
            <s-badge tone={offer.enabled ? "success" : "neutral"}>
              {isToggling ? "..." : offer.enabled ? "Active" : "Off"}
            </s-badge>
          </s-stack>
          {offer.testMode && (
            <s-badge tone="info" icon="sandbox" size="base">Test</s-badge>
          )}
        </s-stack>
      </s-table-cell>

      {/* Discount */}
      <s-table-cell>
        <s-badge tone="success" icon="discount">{discountLabel}</s-badge>
      </s-table-cell>

      {/* Metrics */}
      <s-table-cell>
        <s-text fontVariantNumeric="tabular-nums">{offer.views}</s-text>
      </s-table-cell>
      <s-table-cell>
        <s-text fontVariantNumeric="tabular-nums">{offer.accepts}</s-text>
      </s-table-cell>
      <s-table-cell>
        <s-text fontVariantNumeric="tabular-nums">{offer.conversionRate}%</s-text>
      </s-table-cell>
      <s-table-cell>
        <s-text type="strong" fontVariantNumeric="tabular-nums">{formatPrice(offer.revenue, currency)}</s-text>
      </s-table-cell>

      {/* Actions */}
      <s-table-cell>
        <s-stack direction="inline" gap="small-200">
          <s-button onClick={onEdit} variant="tertiary" icon="edit" accessibilityLabel="Edit offer" />
          <s-button onClick={onDuplicate} variant="tertiary" icon="duplicate" accessibilityLabel="Duplicate offer" />
          <s-button onClick={onDelete} variant="tertiary" tone="critical" icon="delete" accessibilityLabel="Delete offer" />
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}
