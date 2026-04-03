import { useState, useCallback, useEffect } from "react";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
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

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const offer = await db.upsellOffer.findFirst({
    where: { id: params.id, shop: session.shop },
    include: { targetingRules: true },
  });

  if (!offer) {
    throw new Response("Offer not found", { status: 404 });
  }

  return { offer };
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
  const enabled = formData.get("enabled") === "true";
  const testMode = formData.get("testMode") === "true";
  const priority = parseInt(formData.get("priority") as string, 10) || 0;
  const rulesJson = formData.get("targetingRules") as string;

  // Validation
  const errors: Record<string, string> = {};
  if (!title) errors.title = "Title is required";
  if (!productId) errors.productId = "Please select a product";
  if (!discountType) errors.discountType = "Discount type is required";

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  // Fetch price if missing
  let finalPrice = productPrice;
  if (!finalPrice && variantId) {
    const priceResponse = await admin.graphql(
      `#graphql
      query getVariantPrice($id: ID!) {
        productVariant(id: $id) {
          price
        }
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
    // ignore
  }

  // Update offer and replace targeting rules in a transaction
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
        enabled,
        testMode,
        priority,
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
  const { offer } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

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
  const [enabled, setEnabled] = useState(offer.enabled);
  const [testMode, setTestMode] = useState(offer.testMode);
  const [priority, setPriority] = useState(String(offer.priority));
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

  const isSubmitting = fetcher.state !== "idle";
  const errors =
    fetcher.data && "errors" in fetcher.data ? fetcher.data.errors : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if ("deleted" in fetcher.data && fetcher.data.deleted) {
        shopify.toast.show("Offer deleted");
        navigate("/app");
      } else if ("success" in fetcher.data && fetcher.data.success) {
        shopify.toast.show("Offer updated");
        navigate("/app");
      }
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
    formData.set("productId", selectedProduct.productId);
    formData.set("variantId", selectedProduct.variantId);
    formData.set("productTitle", selectedProduct.productTitle);
    formData.set("productImage", selectedProduct.productImage);
    formData.set("productPrice", selectedProduct.productPrice);
    formData.set("discountType", discountType);
    formData.set("discountValue", discountValue);
    formData.set("timeLimitMinutes", timeLimitMinutes);
    formData.set("enabled", String(enabled));
    formData.set("testMode", String(testMode));
    formData.set("priority", priority);
    formData.set("targetingRules", JSON.stringify(targetingRules));

    fetcher.submit(formData, { method: "POST" });
  };

  const handleDelete = () => {
    fetcher.submit({ intent: "delete" }, { method: "POST" });
  };

  return (
    <s-page heading={`Edit: ${offer.title}` as Lowercase<string>}>
      {/* @ts-expect-error slot name uses camelCase for Polaris web component */}
      <s-link slot="breadcrumbActions" href="/app">
        Offers
      </s-link>
      <s-button
        slot="primary-action"
        onClick={handleSubmit}
        loading={isSubmitting || undefined}
      >
        Save changes
      </s-button>

      {/* Basic Info */}
      <s-section heading="Offer Details">
        <s-stack gap="base">
          <s-text-field
            label="Offer Title"
            value={title}
            onChange={(e: any) => setTitle(e.target.value)}
            error={errors?.title}
          />
          <s-text-field
            label="Description"
            value={description}
            onChange={(e: any) => setDescription(e.target.value)}
          />
          <s-text-field
            label="CTA Button Text"
            value={ctaText}
            onChange={(e: any) => setCtaText(e.target.value)}
          />
        </s-stack>
      </s-section>

      {/* Product Selection */}
      <s-section heading="Upsell Product">
        <s-stack gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="small-200">
              <s-text type="strong">{selectedProduct.productTitle}</s-text>
              <s-text color="subdued">
                Price: ${selectedProduct.productPrice}
              </s-text>
              <s-button onClick={handleProductPicker} variant="tertiary">
                Change product
              </s-button>
            </s-stack>
          </s-box>
          {errors?.productId && (
            <s-banner tone="critical">{errors.productId}</s-banner>
          )}
        </s-stack>
      </s-section>

      {/* Discount Settings */}
      <s-section heading="Discount">
        <s-stack gap="base">
          <s-select
            label="Discount Type"
            value={discountType}
            onChange={(e: any) => setDiscountType(e.target.value)}
          >
            <s-option value="percentage">Percentage</s-option>
            <s-option value="fixed">Fixed Amount</s-option>
          </s-select>
          <s-text-field
            label={
              discountType === "percentage"
                ? "Discount Percentage (%)"
                : "Discount Amount ($)"
            }
            value={discountValue}
            onChange={(e: any) => setDiscountValue(e.target.value)}
          />
        </s-stack>
      </s-section>

      {/* Targeting Rules */}
      <s-section heading="Targeting Rules">
        <s-stack gap="base">
          <s-paragraph>
            Define conditions for when this offer should appear. If no rules are
            set, the offer will show for all orders.
          </s-paragraph>
          {targetingRules.map((rule, index) => (
            <s-box
              key={index}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack gap="base">
                <s-stack direction="inline" gap="base">
                  <s-select
                    label="Rule Type"
                    value={rule.ruleType}
                    onChange={(e: any) =>
                      updateRule(index, "ruleType", e.target.value)
                    }
                  >
                    <s-option value="product">Product in Order</s-option>
                    <s-option value="cart_value">Cart Value</s-option>
                  </s-select>
                  <s-select
                    label="Condition"
                    value={rule.operator}
                    onChange={(e: any) =>
                      updateRule(index, "operator", e.target.value)
                    }
                  >
                    {rule.ruleType === "product" ? (
                      <>
                        <s-option value="equals">Equals</s-option>
                        <s-option value="contains">Contains</s-option>
                      </>
                    ) : (
                      <>
                        <s-option value="greater_than">Greater than</s-option>
                        <s-option value="less_than">Less than</s-option>
                        <s-option value="equals">Equals</s-option>
                      </>
                    )}
                  </s-select>
                  {rule.ruleType === "product" ? (
                    <s-stack gap="small-200">
                      {rule.productTitle || rule.value ? (
                        <s-box padding="small-200" borderWidth="base" borderRadius="base">
                          <s-stack direction="inline" gap="base">
                            <s-text>{rule.productTitle || rule.value}</s-text>
                            <s-button
                              onClick={() => pickProductForRule(index)}
                              variant="tertiary"
                            >
                              Change
                            </s-button>
                          </s-stack>
                        </s-box>
                      ) : (
                        <s-button onClick={() => pickProductForRule(index)}>
                          Select product
                        </s-button>
                      )}
                    </s-stack>
                  ) : (
                    <s-text-field
                      label="Amount"
                      value={rule.value}
                      onChange={(e: any) =>
                        updateRule(index, "value", e.target.value)
                      }
                    />
                  )}
                </s-stack>
                <s-button
                  onClick={() => removeRule(index)}
                  variant="tertiary"
                  tone="critical"
                >
                  Remove rule
                </s-button>
              </s-stack>
            </s-box>
          ))}
          <s-button onClick={addRule} variant="secondary">
            Add targeting rule
          </s-button>
        </s-stack>
      </s-section>

      {/* Offer Controls */}
      <s-section heading="Controls">
        <s-stack gap="base">
          <s-text-field
            label="Time Limit (minutes, leave empty for no limit)"
            value={timeLimitMinutes}
            onChange={(e: any) => setTimeLimitMinutes(e.target.value)}
          />
          <s-text-field
            label="Priority (higher = shown first)"
            value={priority}
            onChange={(e: any) => setPriority(e.target.value)}
          />
          <s-checkbox
            checked={enabled}
            onChange={(e: any) => setEnabled(e.target.checked)}
            label="Enabled"
          />
          <s-checkbox
            checked={testMode}
            onChange={(e: any) => setTestMode(e.target.checked)}
            label="Test mode (only show on development stores)"
          />
        </s-stack>
      </s-section>

      {/* Danger Zone */}
      <s-section heading="Danger Zone">
        <s-button onClick={handleDelete} tone="critical">
          Delete this offer
        </s-button>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
