import { useState, useCallback, useEffect } from "react";
import { useNavigate, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Load existing offers for fallback selection
  const existingOffers = await db.upsellOffer.findMany({
    where: { shop: session.shop },
    select: { id: true, title: true, productTitle: true },
    orderBy: { title: "asc" },
  });

  return { existingOffers };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

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
  if (!productId) errors.productId = "Please select a product to upsell";
  if (!discountType) errors.discountType = "Discount type is required";

  // Validate discount value
  if (discountType === "percentage" && discountValue > 100) {
    errors.discountValue = "Percentage discount cannot exceed 100%";
  }
  if (discountValue < 0) {
    errors.discountValue = "Discount cannot be negative";
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

  const offer = await db.upsellOffer.create({
    data: {
      shop: session.shop,
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
  });

  return { success: true, offerId: offer.id };
};

export default function NewOffer() {
  const { existingOffers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ctaText, setCtaText] = useState("Add to Order");
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState("10");
  const [timeLimitMinutes, setTimeLimitMinutes] = useState("");
  const [status, setStatus] = useState("active");
  const [testMode, setTestMode] = useState(false);
  const [priority, setPriority] = useState("0");
  const [fallbackOfferId, setFallbackOfferId] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [targetingRules, setTargetingRules] = useState<TargetingRuleInput[]>(
    [],
  );

  const [selectedProduct, setSelectedProduct] = useState<{
    productId: string;
    variantId: string;
    productTitle: string;
    productImage: string;
    productPrice: string;
  } | null>(null);

  const isSubmitting = fetcher.state !== "idle";
  const errors =
    fetcher.data && "errors" in fetcher.data ? fetcher.data.errors : null;

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      "success" in fetcher.data &&
      fetcher.data.success
    ) {
      shopify.toast.show("Offer created successfully!");
      navigate("/app");
    }
  }, [fetcher.state, fetcher.data, shopify, navigate]);

  const handleProductPicker = useCallback(async () => {
    try {
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: false,
        action: "select",
      });
      if (selected && selected.length > 0) {
        const product = selected[0];
        const variant = product.variants?.[0];
        setSelectedProduct({
          productId: product.id,
          variantId: variant?.id || "",
          productTitle: product.title,
          productImage: product.images?.[0]?.originalSrc || "",
          productPrice: variant?.price || "0.00",
        });
      }
    } catch (err) {
      console.error("Product picker error:", err);
    }
  }, [shopify]);

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
      try {
        const selected = await shopify.resourcePicker({
          type: "product",
          multiple: false,
          action: "select",
        });
        if (selected && selected.length > 0) {
          const product = selected[0];
          const updated = [...targetingRules];
          updated[index] = {
            ...updated[index],
            value: product.id,
            productTitle: product.title,
          };
          setTargetingRules(updated);
        }
      } catch (err) {
        console.error("Product picker error:", err);
      }
    },
    [shopify, targetingRules],
  );

  const handleSubmit = () => {
    const formData = new FormData();
    formData.set("title", title);
    formData.set("description", description);
    formData.set("ctaText", ctaText);
    formData.set("productId", selectedProduct?.productId || "");
    formData.set("variantId", selectedProduct?.variantId || "");
    formData.set("productTitle", selectedProduct?.productTitle || "");
    formData.set("productImage", selectedProduct?.productImage || "");
    formData.set("productPrice", selectedProduct?.productPrice || "");
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

  // Live discount preview
  const originalPrice = selectedProduct
    ? parseFloat(selectedProduct.productPrice)
    : 0;
  const discount = parseFloat(discountValue) || 0;
  const discountedPrice =
    discountType === "percentage"
      ? originalPrice * (1 - discount / 100)
      : originalPrice - discount;
  const finalPrice = Math.max(0, discountedPrice);
  const savings = Math.max(0, originalPrice - finalPrice);

  return (
    <s-page heading="Create Upsell Offer">
      {/* Breadcrumb */}
      <s-box paddingBlockEnd="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-link href="/app">
            <s-icon type="arrow-left" size="small" />
          </s-link>
          <s-link href="/app">Offers</s-link>
          <s-text color="subdued">/</s-text>
          <s-text color="subdued">Create New</s-text>
        </s-stack>
      </s-box>

      <s-button
        variant="primary" slot="primary-action"
        onClick={handleSubmit}
        loading={isSubmitting || undefined}
        icon="save"
      >
        Save offer
      </s-button>

      <s-grid gridTemplateColumns="2fr 1fr" gap="large">
        {/* ── LEFT COLUMN: Form ── */}
        <s-grid-item>
          <s-stack gap="base">
            {/* 1. Offer Details */}
            <s-section heading="Offer Details" padding="base">
              <s-stack gap="base">
                <s-text-field
                  label="Offer Title"
                  value={title}
                  onChange={(e: any) => setTitle(e.target.value)}
                  error={errors?.title}
                />
                <s-text-area
                  label="Description (shown to customer)"
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

            {/* 2. Product Selection */}
            <s-section heading="Upsell Product" padding="base">
              {selectedProduct ? (
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
              ) : (
                <s-stack gap="base">
                  {errors?.productId && (
                    <s-banner tone="critical">{errors.productId}</s-banner>
                  )}
                  <s-box
                    padding="base"
                    borderWidth="base"
                    borderRadius="large"
                    borderStyle="dashed"
                  >
                    <s-stack gap="base" alignItems="center">
                      <s-icon type="product-add" color="subdued" />
                      <s-text color="subdued">
                        Choose the product you want to upsell
                      </s-text>
                      <s-button onClick={handleProductPicker} icon="search">
                        Browse products
                      </s-button>
                    </s-stack>
                  </s-box>
                </s-stack>
              )}
            </s-section>

            {/* 3. Discount */}
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

                {/* Savings preview */}
                {selectedProduct && discount > 0 && (
                  <s-banner tone="success">
                    <s-stack direction="inline" gap="small-200">
                      <s-text>
                        Customer pays{" "}
                        <s-text type="strong">${finalPrice.toFixed(2)}</s-text>{" "}
                        instead of ${originalPrice.toFixed(2)} — saves $
                        {savings.toFixed(2)}
                      </s-text>
                    </s-stack>
                  </s-banner>
                )}
              </s-stack>
            </s-section>

            {/* 4. Targeting Rules */}
            <s-section heading="Targeting Rules" padding="base">
              <s-stack gap="base">
                <s-paragraph color="subdued">
                  Define when this offer appears. Without rules, it shows for
                  every order.
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
                            <s-option value="order_count">
                              Order count
                            </s-option>
                            <s-option value="customer_tag">Customer tag</s-option>
                            <s-option value="collection">Collection</s-option>
                            <s-option value="quantity">Cart quantity</s-option>
                            <s-option value="shipping_country">Shipping country
                            </s-option>
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
                        rule.productTitle ? (
                          <s-stack direction="inline" gap="base" alignItems="center">
                            <s-badge icon="product">
                              {rule.productTitle}
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

            {/* 5. Funnel (Fallback Offer) */}
            {existingOffers.length > 0 && (
              <s-section heading="Funnel" padding="base">
                <s-stack gap="base">
                  <s-paragraph color="subdued">
                    If the customer declines this offer, show a fallback offer
                    automatically — creating a multi-step upsell funnel.
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

            {/* 6. Controls */}
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
                        <s-text-field
                          label="Time limit (minutes)"
                          value={timeLimitMinutes}
                          onChange={(e: any) =>
                            setTimeLimitMinutes(e.target.value)
                          }
                        />
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
                          onChange={(e: any) =>
                            setScheduledStart(e.target.value)
                          }
                        />
                      </s-grid-item>
                      <s-grid-item>
                        <s-date-field
                          label="End date (optional)"
                          value={scheduledEnd}
                          onChange={(e: any) =>
                            setScheduledEnd(e.target.value)
                          }
                        />
                      </s-grid-item>
                    </s-grid>
                    <s-text color="subdued">
                      Set dates to auto-enable/disable this offer. Leave empty
                      for always active.
                    </s-text>
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
                      <s-option value="draft">Draft — not visible to customers</s-option>
                      <s-option value="active">Active — live on thank-you page</s-option>
                      <s-option value="paused">Paused — temporarily hidden</s-option>
                    </s-select>
                    <s-divider />
                    <s-stack direction="inline" gap="base" alignItems="center">
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
          </s-stack>
        </s-grid-item>

        {/* ── RIGHT COLUMN: Live Preview ── */}
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

              {/* Preview card (mimics extension UI) */}
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="large"
                background="base"
              >
                <s-stack gap="base">
                  {/* Badges */}
                  <s-stack direction="inline" gap="small-200">
                    <s-badge tone="info">Exclusive Offer</s-badge>
                    {discount > 0 && (
                      <s-badge tone="success">
                        {discountType === "percentage"
                          ? `${discount}% off`
                          : `$${discount} off`}
                      </s-badge>
                    )}
                  </s-stack>

                  {/* Title */}
                  <s-text type="strong">{title || "Your Offer Title"}</s-text>
                  {description && (
                    <s-text color="subdued">{description}</s-text>
                  )}

                  {/* Product preview */}
                  {selectedProduct ? (
                    <s-box
                      padding="small-200"
                      borderRadius="base"
                      borderWidth="base"
                      background="subdued"
                    >
                      <s-stack direction="inline" gap="base">
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
                          <s-stack direction="inline" gap="small-100">
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
                            <s-paragraph tone="success">
                              You save ${savings.toFixed(2)}
                            </s-paragraph>
                          )}
                        </s-stack>
                      </s-stack>
                    </s-box>
                  ) : (
                    <s-box
                      padding="base"
                      borderRadius="base"
                      background="subdued"
                    >
                      <s-text color="subdued">
                        Product preview will appear here
                      </s-text>
                    </s-box>
                  )}

                  {/* Timer preview */}
                  {timeLimitMinutes && (
                    <s-stack gap="small-100">
                      <s-text color="subdued">
                        Expires in {timeLimitMinutes}:00
                      </s-text>
                      <s-box
                        borderRadius="base"
                        background="subdued"
                        blockSize="4px"
                      >
                        <s-box
                          borderRadius="base"
                          background="base"
                          blockSize="4px"
                          inlineSize="100%"
                        />
                      </s-box>
                    </s-stack>
                  )}

                  {/* Trust signals */}
                  <s-stack direction="inline" gap="base">
                    <s-stack direction="inline" gap="small-100">
                      <s-icon type="bolt" color="subdued" size="small" />
                      <s-text color="subdued">One-click add</s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="small-100">
                      <s-icon type="lock" color="subdued" size="small" />
                      <s-text color="subdued">Secure</s-text>
                    </s-stack>
                  </s-stack>

                  {/* Buttons */}
                  <s-stack direction="inline" gap="small-200">
                    <s-button variant="primary">
                      {ctaText || "Add to Order"}
                    </s-button>
                    <s-button variant="secondary">No thanks</s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            </s-stack>
          </s-box>
        </s-grid-item>
      </s-grid>
    </s-page>
  );
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
