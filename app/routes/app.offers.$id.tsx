import { useState, useCallback, useRef } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useProductPicker } from "../hooks/useProductPicker";
import { useToast } from "../hooks/useToast";
import { usePlanLimits } from "../hooks/usePlanLimits";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type {
  ActionFunctionArgs,
  HeadersArgs,
  LoaderFunctionArgs,
} from "react-router";

interface TargetingRuleInput {
  ruleType: string;
  operator: string;
  value: string;
  productTitle?: string;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const offer = await db.upsellOffer.findFirst({
    where: { id: params.id, shop: session.shop },
    include: {
      targetingRules: true,
      analyticsEvents: {
        select: { eventType: true, revenue: true },
      },
    },
  });

  if (!offer) {
    throw new Response("Offer not found", { status: 404 });
  }

  const views = offer.analyticsEvents.filter(
    (e) => e.eventType === "view",
  ).length;
  const accepts = offer.analyticsEvents.filter(
    (e) => e.eventType === "accept",
  ).length;
  const declines = offer.analyticsEvents.filter(
    (e) => e.eventType === "decline",
  ).length;
  const revenue = offer.analyticsEvents
    .filter((e) => e.eventType === "accept" && e.revenue)
    .reduce((sum, e) => sum + (e.revenue || 0), 0);

  // Load existing offers for fallback selection (exclude self)
  const existingOffers = await db.upsellOffer.findMany({
    where: { shop: session.shop, id: { not: params.id } },
    select: { id: true, title: true, productTitle: true },
    orderBy: { title: "asc" },
  });

  return {
    offer,
    existingOffers,
    stats: {
      views,
      accepts,
      declines,
      revenue,
      conversionRate: views > 0 ? Math.round((accepts / views) * 100) : 0,
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "delete") {
    await db.upsellOffer.deleteMany({
      where: { id: params.id, shop: session.shop },
    });
    return { success: true, deleted: true };
  }

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const ctaText = (formData.get("ctaText") as string) || "Add to Order";
  const productId = formData.get("productId") as string;
  const variantId = formData.get("variantId") as string;
  const productTitle = formData.get("productTitle") as string;
  const productImage = formData.get("productImage") as string;
  const productPrice = formData.get("productPrice") as string;
  const discountType = formData.get("discountType") as string;
  const discountValue =
    parseFloat(formData.get("discountValue") as string) || 0;
  const timeLimitMinutes = formData.get("timeLimitMinutes")
    ? parseInt(formData.get("timeLimitMinutes") as string, 10)
    : null;
  const status = (formData.get("status") as string) || "active";
  const testMode = formData.get("testMode") === "true";
  const priority = parseInt(formData.get("priority") as string, 10) || 0;
  const fallbackOfferId = (formData.get("fallbackOfferId") as string) || null;
  const scheduledStart = formData.get("scheduledStart") as string;
  const scheduledEnd = formData.get("scheduledEnd") as string;
  const rulesJson = formData.get("targetingRules") as string;

  const errors: Record<string, string> = {};
  if (!title) errors.title = "Title is required";
  if (!productId) errors.productId = "Please select a product";
  if (!discountType) errors.discountType = "Discount type is required";

  // Validate discount
  if (discountType === "percentage" && discountValue > 100) {
    errors.discountValue = "Percentage discount cannot exceed 100%";
  }
  if (discountValue < 0) {
    errors.discountValue = "Discount cannot be negative";
  }

  // Prevent circular fallback
  if (fallbackOfferId === params.id) {
    errors.fallbackOfferId = "An offer cannot be its own fallback";
  }
  if (fallbackOfferId) {
    const fallbackOffer = await db.upsellOffer.findFirst({
      where: { id: fallbackOfferId },
      select: { fallbackOfferId: true },
    });
    if (fallbackOffer?.fallbackOfferId === params.id) {
      errors.fallbackOfferId = "Circular fallback detected — this offer is already the fallback's fallback";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  let finalPrice = productPrice;
  if (!finalPrice && variantId) {
    const priceResponse = await admin.graphql(
      `#graphql
      query getVariantPrice($id: ID!) {
        productVariant(id: $id) { price }
      }`,
      { variables: { id: variantId } },
    );
    const priceData = await priceResponse.json();
    finalPrice = priceData.data?.productVariant?.price || "0.00";
  }

  let rules: TargetingRuleInput[] = [];
  try {
    rules = rulesJson ? JSON.parse(rulesJson) : [];
  } catch {
    /* ignore */
  }

  await db.$transaction([
    db.targetingRule.deleteMany({ where: { offerId: params.id! } }),
    db.upsellOffer.update({
      where: { id: params.id! },
      data: {
        title,
        description: description || "",
        ctaText,
        productId,
        variantId,
        productTitle,
        productImage: productImage || null,
        productPrice: finalPrice,
        discountType,
        discountValue,
        timeLimitMinutes,
        status,
        testMode,
        priority,
        fallbackOfferId,
        scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
        targetingRules: {
          create: rules
            .filter((r) => r.ruleType && r.value)
            .map((r) => ({
              ruleType: r.ruleType,
              operator: r.operator || "equals",
              value: r.value,
            })),
        },
      },
    }),
  ]);

  return { success: true };
};

export default function EditOffer() {
  const { offer, stats, existingOffers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const deleteModalRef = useRef<any>(null);
  const { limits } = usePlanLimits();

  const [title, setTitle] = useState(offer.title);
  const [description, setDescription] = useState(offer.description);
  const [ctaText, setCtaText] = useState(offer.ctaText);
  const [discountType, setDiscountType] = useState(offer.discountType);
  const [discountValue, setDiscountValue] = useState(
    String(offer.discountValue),
  );
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(
    offer.timeLimitMinutes ? String(offer.timeLimitMinutes) : "",
  );
  const [status, setStatus] = useState(offer.status);
  const [testMode, setTestMode] = useState(offer.testMode);
  const [priority, setPriority] = useState(String(offer.priority));
  const [fallbackOfferId, setFallbackOfferId] = useState(
    offer.fallbackOfferId || "",
  );
  const [scheduledStart, setScheduledStart] = useState(
    offer.scheduledStart
      ? new Date(offer.scheduledStart).toISOString().slice(0, 10)
      : "",
  );
  const [scheduledEnd, setScheduledEnd] = useState(
    offer.scheduledEnd
      ? new Date(offer.scheduledEnd).toISOString().slice(0, 10)
      : "",
  );
  const [targetingRules, setTargetingRules] = useState<TargetingRuleInput[]>(
    offer.targetingRules.map((r) => ({
      ruleType: r.ruleType,
      operator: r.operator,
      value: r.value,
      productTitle: r.ruleType === "product" ? "" : undefined,
    })),
  );
  const [selectedProduct, setSelectedProduct] = useState({
    productId: offer.productId,
    variantId: offer.variantId,
    productTitle: offer.productTitle,
    productImage: offer.productImage || "",
    productPrice: offer.productPrice,
  });

  const { pickProduct, pickProductForRule: pickProductRule } = useProductPicker();

  const isSubmitting = fetcher.state !== "idle";
  const errors =
    fetcher.data && "errors" in fetcher.data ? fetcher.data.errors : null;

  useToast(fetcher, {
    deleted: "Offer deleted",
    success: "Offer saved",
  }, () => navigate("/app"));

  const handleProductPicker = useCallback(async () => {
    const result = await pickProduct();
    if (result) setSelectedProduct(result);
  }, [pickProduct]);

  const addRule = () => {
    setTargetingRules([
      ...targetingRules,
      { ruleType: "product", operator: "equals", value: "", productTitle: "" },
    ]);
  };

  const updateRule = (
    index: number,
    field: keyof TargetingRuleInput,
    value: string,
  ) => {
    const updated = [...targetingRules];
    updated[index] = { ...updated[index], [field]: value };
    setTargetingRules(updated);
  };

  const removeRule = (index: number) => {
    setTargetingRules(targetingRules.filter((_, i) => i !== index));
  };

  const pickProductForRule = useCallback(
    async (index: number) => {
      const result = await pickProductRule();
      if (result) {
        const updated = [...targetingRules];
        updated[index] = { ...updated[index], value: result.id, productTitle: result.title };
        setTargetingRules(updated);
      }
    },
    [pickProductRule, targetingRules],
  );

  const handleSubmit = () => {
    const formData = new FormData();
    formData.set("title", title);
    formData.set("description", description);
    formData.set("ctaText", ctaText);
    formData.set("productId", selectedProduct.productId);
    formData.set("variantId", selectedProduct.variantId);
    formData.set("productTitle", selectedProduct.productTitle);
    formData.set("productImage", selectedProduct.productImage);
    formData.set("productPrice", selectedProduct.productPrice);
    formData.set("discountType", discountType);
    formData.set("discountValue", discountValue);
    formData.set("timeLimitMinutes", timeLimitMinutes);
    formData.set("status", status);
    formData.set("testMode", String(testMode));
    formData.set("priority", priority);
    formData.set("fallbackOfferId", fallbackOfferId);
    formData.set("scheduledStart", scheduledStart);
    formData.set("scheduledEnd", scheduledEnd);
    formData.set("targetingRules", JSON.stringify(targetingRules));
    fetcher.submit(formData, { method: "POST" });
  };

  // Live preview
  const originalPrice = parseFloat(selectedProduct.productPrice);
  const discount = parseFloat(discountValue) || 0;
  const discountedPrice =
    discountType === "percentage"
      ? originalPrice * (1 - discount / 100)
      : originalPrice - discount;
  const finalPrice = Math.max(0, discountedPrice);
  const savings = Math.max(0, originalPrice - finalPrice);

  return (
    <s-page heading={`Edit: ${offer.title}` as Lowercase<string>}>
      {/* Breadcrumb */}
      <s-box paddingBlockEnd="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-link href="/app">
            <s-icon type="arrow-left" size="small" />
          </s-link>
          <s-link href="/app">Offers</s-link>
          <s-text color="subdued">/</s-text>
          <s-text color="subdued">{offer.title}</s-text>
        </s-stack>
      </s-box>

      <s-button
        variant="primary" slot="primary-action"
        onClick={handleSubmit}
        loading={isSubmitting || undefined}
        icon="save"
      >
        Save changes
      </s-button>

      {/* Performance Stats */}
      <s-section>
        <s-grid gridTemplateColumns="1fr 1fr 1fr 1fr 1fr" gap="base">
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="view" color="subdued" size="small" />
                  <s-text color="subdued">Views</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {stats.views}
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="check-circle" color="subdued" size="small" />
                  <s-text color="subdued">Accepts</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {stats.accepts}
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="x-circle" color="subdued" size="small" />
                  <s-text color="subdued">Declines</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {stats.declines}
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="chart-funnel" color="subdued" size="small" />
                  <s-text color="subdued">Conversion</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  {stats.conversionRate}%
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
          <s-grid-item>
            <s-box padding="base" borderWidth="base" borderRadius="large">
              <s-stack gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="cash-dollar" color="subdued" size="small" />
                  <s-text color="subdued">Revenue</s-text>
                </s-stack>
                <s-text type="strong" fontVariantNumeric="tabular-nums">
                  ${stats.revenue.toFixed(2)}
                </s-text>
              </s-stack>
            </s-box>
          </s-grid-item>
        </s-grid>
      </s-section>

      <s-grid gridTemplateColumns="2fr 1fr" gap="large">
        {/* ── LEFT: Form ── */}
        <s-grid-item>
          <s-stack gap="base">
            {/* Offer Details */}
            <s-section heading="Offer Details" padding="base">
              <s-stack gap="base">
                <s-text-field
                  label="Offer Title"
                  value={title}
                  onChange={(e: any) => setTitle(e.target.value)}
                  error={errors?.title}
                />
                <s-text-area
                  label="Description"
                  value={description}
                  onChange={(e: any) => setDescription(e.target.value)}
                  rows={3}
                />
                <s-text-field
                  label="CTA Button Text"
                  value={ctaText}
                  onChange={(e: any) => setCtaText(e.target.value)}
                />
              </s-stack>
            </s-section>

            {/* Product */}
            <s-section heading="Upsell Product" padding="base">
              <s-box padding="base" borderWidth="base" borderRadius="large">
                <s-stack direction="inline" gap="base" alignItems="center">
                  {selectedProduct.productImage ? (
                    <s-thumbnail
                      src={selectedProduct.productImage}
                      alt={selectedProduct.productTitle}
                      size="base"
                    />
                  ) : (
                    <s-box
                      padding="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-icon type="product" color="subdued" />
                    </s-box>
                  )}
                  <s-stack gap="small-100">
                    <s-text type="strong">
                      {selectedProduct.productTitle}
                    </s-text>
                    <s-text fontVariantNumeric="tabular-nums">
                      ${selectedProduct.productPrice}
                    </s-text>
                  </s-stack>
                  <s-button
                    onClick={handleProductPicker}
                    variant="tertiary"
                    icon="replace"
                  >
                    Change
                  </s-button>
                </s-stack>
              </s-box>
              {errors?.productId && (
                <s-banner tone="critical">{errors.productId}</s-banner>
              )}
            </s-section>

            {/* Discount */}
            <s-section heading="Discount" padding="base">
              <s-stack gap="base">
                <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                  <s-grid-item>
                    <s-select
                      label="Discount Type"
                      value={discountType}
                      onChange={(e: any) => setDiscountType(e.target.value)}
                      icon="discount"
                    >
                      <s-option value="percentage">Percentage (%)</s-option>
                      <s-option value="fixed">Fixed Amount ($)</s-option>
                    </s-select>
                  </s-grid-item>
                  <s-grid-item>
                    <s-text-field
                      label={
                        discountType === "percentage"
                          ? "Discount (%)"
                          : "Discount ($)"
                      }
                      value={discountValue}
                      onChange={(e: any) => setDiscountValue(e.target.value)}
                    />
                  </s-grid-item>
                </s-grid>

                {discount > 0 && (
                  <s-banner tone="success">
                    <s-text>
                      Customer pays{" "}
                      <s-text type="strong">${finalPrice.toFixed(2)}</s-text>{" "}
                      instead of ${originalPrice.toFixed(2)} — saves $
                      {savings.toFixed(2)}
                    </s-text>
                  </s-banner>
                )}
              </s-stack>
            </s-section>

            {/* Targeting Rules */}
            <s-section heading="Targeting Rules" padding="base">
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  Without rules, this offer shows for every order.
                </s-paragraph>

                {targetingRules.map((rule, index) => (
                  <s-box
                    key={index}
                    padding="base"
                    borderWidth="base"
                    borderRadius="large"
                  >
                    <s-stack gap="base">
                      <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                        <s-grid-item>
                          <s-select
                            label="When"
                            value={rule.ruleType}
                            onChange={(e: any) =>
                              updateRule(index, "ruleType", e.target.value)
                            }
                          >
                            <s-option value="product">
                              Product in order
                            </s-option>
                            <s-option value="cart_value">Cart value</s-option>
                            <s-option value="order_count">Order count</s-option>
                            <s-option value="customer_tag">Customer tag</s-option>
                            <s-option value="collection">Collection</s-option>
                            <s-option value="quantity">Cart quantity</s-option>
                            <s-option value="shipping_country">Shipping country</s-option>
                          </s-select>
                        </s-grid-item>
                        <s-grid-item>
                          <s-select
                            label="Condition"
                            value={rule.operator}
                            onChange={(e: any) =>
                              updateRule(index, "operator", e.target.value)
                            }
                          >
                            {rule.ruleType === "product" ? (
                              <>
                                <s-option value="equals">Is</s-option>
                                <s-option value="not_equals">Is not</s-option>
                              </>
                            ) : rule.ruleType === "customer_tag" ? (
                              <>
                                <s-option value="equals">Has tag</s-option>
                                <s-option value="not_equals">Doesn't have</s-option>
                              </>
                            ) : (
                              <>
                                <s-option value="greater_than">Greater than</s-option>
                                <s-option value="less_than">Less than</s-option>
                                <s-option value="equals">Equals</s-option>
                              </>
                            )}
                          </s-select>
                        </s-grid-item>
                      </s-grid>

                      {rule.ruleType === "product" ? (
                        rule.productTitle || rule.value ? (
                          <s-stack
                            direction="inline"
                            gap="base"
                            alignItems="center"
                          >
                            <s-badge icon="product">
                              {rule.productTitle || rule.value}
                            </s-badge>
                            <s-button
                              onClick={() => pickProductForRule(index)}
                              variant="tertiary"
                              icon="replace"
                            >
                              Change
                            </s-button>
                          </s-stack>
                        ) : (
                          <s-button
                            onClick={() => pickProductForRule(index)}
                            icon="search"
                          >
                            Select product
                          </s-button>
                        )
                      ) : rule.ruleType === "customer_tag" ? (
                        <s-text-field
                          label="Customer tag"
                          value={rule.value}
                          onChange={(e: any) =>
                            updateRule(index, "value", e.target.value)
                          }
                        />
                      ) : rule.ruleType === "order_count" ? (
                        <s-text-field
                          label="Number of orders"
                          value={rule.value}
                          onChange={(e: any) =>
                            updateRule(index, "value", e.target.value)
                          }
                        />
                      ) : rule.ruleType === "quantity" ? (
                        <s-text-field
                          label="Total items in cart"
                          value={rule.value}
                          onChange={(e: any) =>
                            updateRule(index, "value", e.target.value)
                          }
                        />
                      ) : rule.ruleType === "shipping_country" ? (
                        <s-text-field
                          label="Country code (e.g. US, CA, GB)"
                          value={rule.value}
                          onChange={(e: any) =>
                            updateRule(index, "value", e.target.value)
                          }
                        />
                      ) : rule.ruleType === "collection" ? (
                        <s-text-field
                          label="Collection ID"
                          value={rule.value}
                          onChange={(e: any) =>
                            updateRule(index, "value", e.target.value)
                          }
                        />
                      ) : (
                        <s-text-field
                          label="Amount ($)"
                          value={rule.value}
                          onChange={(e: any) =>
                            updateRule(index, "value", e.target.value)
                          }
                        />
                      )}

                      <s-button
                        onClick={() => removeRule(index)}
                        variant="tertiary"
                        tone="critical"
                        icon="delete"
                      >
                        Remove
                      </s-button>
                    </s-stack>
                  </s-box>
                ))}

                <s-button onClick={addRule} variant="secondary" icon="plus">
                  Add rule
                </s-button>
              </s-stack>
            </s-section>

            {/* Controls */}
            {/* Funnel — only if plan allows */}
            {limits.funnelChaining && existingOffers.length > 0 && (
              <s-section heading="Funnel" padding="base">
                <s-stack gap="base">
                  <s-paragraph color="subdued">
                    If the customer declines this offer, show a fallback offer
                    automatically.
                  </s-paragraph>
                  <s-select
                    label="Fallback offer (shown if declined)"
                    value={fallbackOfferId}
                    onChange={(e: any) => setFallbackOfferId(e.target.value)}
                    icon="chart-funnel"
                  >
                    <s-option value="">No fallback (end funnel)</s-option>
                    {existingOffers.map((o) => (
                      <s-option key={o.id} value={o.id}>
                        {o.title} — {o.productTitle}
                      </s-option>
                    ))}
                  </s-select>
                </s-stack>
              </s-section>
            )}

            <s-section heading="Controls" padding="base">
              <s-stack gap="base">
                {/* Time & Priority */}
                <s-box padding="base" borderWidth="base" borderRadius="large">
                  <s-stack gap="base">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-icon type="clock" color="subdued" size="small" />
                      <s-text type="strong">Timing & Priority</s-text>
                    </s-stack>
                    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                      <s-grid-item>
                        {limits.scheduledOffers ? (
                          <s-text-field
                            label="Countdown timer (minutes)"
                            value={timeLimitMinutes}
                            onChange={(e: any) => setTimeLimitMinutes(e.target.value)}
                          />
                        ) : (
                          <s-stack gap="small-200">
                            <s-text color="subdued">Countdown timer</s-text>
                            <s-badge tone="info">Pro plan</s-badge>
                          </s-stack>
                        )}
                      </s-grid-item>
                      <s-grid-item>
                        <s-text-field
                          label="Priority (higher = shown first)"
                          value={priority}
                          onChange={(e: any) => setPriority(e.target.value)}
                        />
                      </s-grid-item>
                    </s-grid>
                    <s-text color="subdued">
                      Leave time limit empty for no expiration. Higher priority
                      offers are shown first when multiple match.
                    </s-text>

                    {/* Schedule — only if plan allows */}
                    {limits.scheduledOffers && (
                      <>
                        <s-divider />
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-icon type="calendar" color="subdued" size="small" />
                          <s-text type="strong">Schedule</s-text>
                        </s-stack>
                        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                          <s-grid-item>
                            <s-date-field
                              label="Start date (optional)"
                              value={scheduledStart}
                              onChange={(e: any) => setScheduledStart(e.target.value)}
                            />
                          </s-grid-item>
                          <s-grid-item>
                            <s-date-field
                              label="End date (optional)"
                              value={scheduledEnd}
                              onChange={(e: any) => setScheduledEnd(e.target.value)}
                            />
                          </s-grid-item>
                        </s-grid>
                        <s-text color="subdued">
                          Set dates to auto-enable/disable this offer. Leave empty for always active.
                        </s-text>
                      </>
                    )}
                  </s-stack>
                </s-box>

                {/* Visibility toggles */}
                <s-box padding="base" borderWidth="base" borderRadius="large">
                  <s-stack gap="base">
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-icon type="enabled" color="subdued" size="small" />
                      <s-text type="strong">Visibility</s-text>
                    </s-stack>
                    <s-divider />
                    <s-select
                      label="Status"
                      value={status}
                      onChange={(e: any) => setStatus(e.target.value)}
                      icon="status"
                    >
                      <s-option value="draft">Draft — not visible</s-option>
                      <s-option value="active">Active — live</s-option>
                      <s-option value="paused">Paused — hidden</s-option>
                    </s-select>
                    <s-divider />
                    <s-stack
                      direction="inline"
                      gap="base"
                      alignItems="center"
                    >
                      <s-switch
                        checked={testMode}
                        onChange={(e: any) => setTestMode(e.target.checked)}
                        label="Test mode"
                        labelAccessibilityVisibility="exclusive"
                      />
                      <s-stack gap="small-100">
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-text type="strong">Test mode</s-text>
                          <s-badge tone="info" icon="sandbox">Dev only</s-badge>
                        </s-stack>
                        <s-text color="subdued">
                          Only visible on development stores for testing
                        </s-text>
                      </s-stack>
                    </s-stack>
                  </s-stack>
                </s-box>
              </s-stack>
            </s-section>

            {/* Delete */}
            <s-section padding="base">
              <s-banner tone="critical" heading="Delete this offer">
                <s-stack gap="base">
                  <s-text>
                    This will permanently remove this offer and all its data.
                  </s-text>
                  <s-button
                    tone="critical"
                    icon="delete"
                    onClick={() => deleteModalRef.current?.showOverlay()}
                  >
                    Delete offer
                  </s-button>
                </s-stack>
              </s-banner>
            </s-section>
          </s-stack>
        </s-grid-item>

        {/* ── RIGHT: Live Preview ── */}
        <s-grid-item>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="large"
            background="subdued"
          >
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-icon type="view" color="subdued" size="small" />
                <s-text type="strong">Customer Preview</s-text>
              </s-stack>
              <s-divider />

              {/* Preview card (matches extension UI) */}
              <s-box borderWidth="base" borderRadius="base" overflow="hidden">
                <s-stack gap="none">
                  {/* Header banner */}
                  <s-box padding="small-200 small-300" background="subdued">
                    <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                      <s-stack direction="inline" gap="small-100" alignItems="center">
                        <s-icon type="discount" size="small" />
                        <s-text type="strong">Exclusive Offer</s-text>
                      </s-stack>
                      <s-stack direction="inline" gap="small-100">
                        {discount > 0 && (
                          <s-badge tone="critical">
                            {discountType === "percentage"
                              ? `${discount}% off`
                              : `$${discount} off`}
                          </s-badge>
                        )}
                        {Number(timeLimitMinutes) > 0 && (
                          <s-badge tone="critical">Limited Time</s-badge>
                        )}
                      </s-stack>
                    </s-stack>
                  </s-box>

                  {/* Title & description */}
                  <s-box padding="small-200 small-300">
                    <s-stack gap="small-100">
                      <s-text type="strong">{title || "Your Offer Title"}</s-text>
                      {description && (
                        <s-text color="subdued">{description}</s-text>
                      )}
                    </s-stack>
                  </s-box>

                  {/* Product card */}
                  <s-box paddingInline="small-300" paddingBlock="small-100">
                    <s-box padding="small-200" borderRadius="base" borderWidth="base" background="subdued">
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        {selectedProduct.productImage && (
                          <s-thumbnail
                            src={selectedProduct.productImage}
                            alt={selectedProduct.productTitle}
                            size="base"
                          />
                        )}
                        <s-stack gap="small-100">
                          <s-text type="strong">
                            {selectedProduct.productTitle}
                          </s-text>
                          <s-stack direction="inline" gap="small-100" alignItems="center">
                            <s-text type="strong">
                              ${finalPrice.toFixed(2)}
                            </s-text>
                            {discount > 0 && (
                              <s-text color="subdued">
                                ${originalPrice.toFixed(2)}
                              </s-text>
                            )}
                          </s-stack>
                          {savings > 0 && (
                            <s-badge>
                              You save ${savings.toFixed(2)}
                            </s-badge>
                          )}
                        </s-stack>
                      </s-stack>
                    </s-box>
                  </s-box>

                  {/* Timer preview */}
                  {Number(timeLimitMinutes) > 0 && (
                    <s-box paddingInline="small-300" paddingBlock="small-100">
                      <s-stack gap="small-100">
                        <s-stack direction="inline" gap="small-100" alignItems="center">
                          <s-icon type="clock" size="small" />
                          <s-text color="subdued" type="strong">
                            Offer expires in {timeLimitMinutes}:00
                          </s-text>
                        </s-stack>
                        <s-box borderRadius="base" background="subdued" blockSize="4px" overflow="hidden">
                          <s-box borderRadius="base" background="base" blockSize="4px" inlineSize="100%" />
                        </s-box>
                      </s-stack>
                    </s-box>
                  )}

                  {/* Trust signals */}
                  <s-box paddingInline="small-300" paddingBlock="small-100">
                    <s-stack direction="inline" gap="small-300" justifyContent="center" alignItems="center">
                      <s-stack direction="inline" gap="small-100" alignItems="center">
                        <s-icon type="cart" size="small" />
                        <s-text color="subdued">One-click add</s-text>
                      </s-stack>
                      <s-stack direction="inline" gap="small-100" alignItems="center">
                        <s-icon type="lock" size="small" />
                        <s-text color="subdued">Secure checkout</s-text>
                      </s-stack>
                      <s-stack direction="inline" gap="small-100" alignItems="center">
                        <s-icon type="check" size="small" />
                        <s-text color="subdued">Money-back guarantee</s-text>
                      </s-stack>
                    </s-stack>
                  </s-box>

                  {/* Buttons */}
                  <s-box paddingInline="small-300" paddingBlock="small-200">
                    <s-stack direction="inline" gap="small-100">
                      <s-button variant="primary">
                        {ctaText || "Yes, Add to My Order"}
                      </s-button>
                      <s-button variant="secondary">No Thanks</s-button>
                    </s-stack>
                  </s-box>
                </s-stack>
              </s-box>
            </s-stack>
          </s-box>
        </s-grid-item>
      </s-grid>

      {/* Delete Confirmation Modal */}
      <s-modal accessibilityLabel="Delete offer confirmation"
        id="delete-offer-modal"
        ref={deleteModalRef}
        heading="Delete this offer?"
      >
        <s-stack gap="base">
          <s-paragraph>
            This will permanently delete{" "}
            <s-text type="strong">{offer.title}</s-text> and remove all{" "}
            {stats.views + stats.accepts + stats.declines} analytics events.
            This cannot be undone.
          </s-paragraph>
          {stats.revenue > 0 && (
            <s-banner tone="warning">
              This offer has generated ${stats.revenue.toFixed(2)} in revenue.
            </s-banner>
          )}
        </s-stack>
        <s-button
          variant="primary" slot="primary-action"
          tone="critical"
          onClick={() => {
            fetcher.submit({ intent: "delete" }, { method: "POST" });
            deleteModalRef.current?.hideOverlay();
          }}
        >
          Delete permanently
        </s-button>
        <s-button
          slot="secondary-action"
          onClick={() => deleteModalRef.current?.hideOverlay()}
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
