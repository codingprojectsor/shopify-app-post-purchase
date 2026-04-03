import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

export default async () => {
  render(<UpsellOffer />, document.body);
};

function UpsellOffer() {
  const [state, setState] = useState("loading"); // loading | offer | accepted | declined | expired | error | empty
  const [offer, setOffer] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [error, setError] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const timerRef = useRef(null);

  // Fetch the matching offer on mount
  useEffect(() => {
    fetchOffer();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Countdown timer
  useEffect(() => {
    if (timeRemaining === null || timeRemaining <= 0) return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setState("expired");
          trackEvent("decline");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timeRemaining !== null]);

  function getAppUrl() {
    // 1. Check extension settings (set in Checkout Editor)
    const settings = shopify.settings?.value;
    if (settings?.app_url) return settings.app_url.replace(/\/+$/, "");

    // 2. Check app metafield (set by the app backend)
    const metafield = shopify.appMetafields?.value?.find(
      (m) =>
        m.metafield?.namespace === "$app" && m.metafield?.key === "app_url",
    );
    if (metafield?.metafield?.value) return metafield.metafield.value.replace(/\/+$/, "");

    return "";
  }

  async function fetchOffer() {
    try {
      let appUrl = getAppUrl();

      if (!appUrl) {
        console.warn("No app_url configured. Set it in extension settings or shop metafield.");
        setState("empty");
        return;
      }

      const token = await shopify.sessionToken.get();

      // Get order data from thank-you page APIs
      // orderConfirmation only has: { order: { id }, number, isFirstOrder }
      const orderConfirmation = shopify.orderConfirmation?.value;
      if (!orderConfirmation?.order?.id) {
        setState("empty");
        return;
      }

      // Line items are on shopify.lines, cost on shopify.cost
      const lines = shopify.lines?.value || [];
      const totalAmount = shopify.cost?.totalAmount?.value;

      const response = await fetch(`${appUrl}/api/upsell/offer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: orderConfirmation.order.id,
          orderNumber: orderConfirmation.number,
          lineItems: lines.map((line) => ({
            productId: line.merchandise?.product?.id,
            variantId: line.merchandise?.id,
            quantity: line.quantity,
          })),
          orderTotal: totalAmount?.amount
            ? parseFloat(totalAmount.amount)
            : 0,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch offer: ${response.status}`);
      }

      const data = await response.json();

      if (!data.offer) {
        setState("empty");
        return;
      }

      setOffer(data.offer);
      setState("offer");

      // Start countdown timer if time limit is set
      if (data.offer.timeLimitMinutes) {
        setTimeRemaining(data.offer.timeLimitMinutes * 60);
      }

      // Track view event
      trackEvent("view", data.offer.id);
    } catch (err) {
      console.error("Error fetching upsell offer:", err);
      setError(err.message);
      setState("error");
    }
  }

  async function trackEvent(eventType, offerId) {
    try {
      const appUrl = getAppUrl();
      if (!appUrl) return;

      const token = await shopify.sessionToken.get();

      await fetch(`${appUrl}/api/upsell/track`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          offerId: offerId || offer?.id,
          eventType,
        }),
      });
    } catch (err) {
      console.error("Error tracking event:", err);
    }
  }

  const handleAccept = useCallback(async () => {
    if (accepting) return;
    setAccepting(true);

    try {
      const appUrl = getAppUrl();
      if (!appUrl) throw new Error("App URL not configured");

      const token = await shopify.sessionToken.get();
      const orderConfirmation = shopify.orderConfirmation?.value;

      const response = await fetch(`${appUrl}/api/upsell/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          offerId: offer.id,
          orderId: orderConfirmation.order.id,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to add item to order");
      }

      if (timerRef.current) clearInterval(timerRef.current);
      setState("accepted");
    } catch (err) {
      console.error("Error accepting upsell:", err);
      setError(err.message);
      setAccepting(false);
    }
  }, [offer, accepting]);

  const handleDecline = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    trackEvent("decline");
    setState("declined");
  }, [offer]);

  // --- Render states ---

  if (state === "loading") {
    return (
      <s-stack gap="base">
        <s-text>{shopify.i18n.translate("loading")}</s-text>
      </s-stack>
    );
  }

  if (state === "empty" || state === "declined") {
    return null;
  }

  if (state === "error") {
    return null; // Silently fail — don't disrupt the thank-you page
  }

  if (state === "expired") {
    return (
      <s-banner heading={shopify.i18n.translate("offerExpiredTitle")} tone="warning">
        <s-text>{shopify.i18n.translate("offerExpired")}</s-text>
      </s-banner>
    );
  }

  if (state === "accepted") {
    return (
      <s-banner heading={shopify.i18n.translate("acceptedTitle")} tone="success">
        <s-stack gap="base">
          <s-text>
            {shopify.i18n.translate("acceptedMessage", {
              product: offer.productTitle,
            })}
          </s-text>
        </s-stack>
      </s-banner>
    );
  }

  // --- Main offer display ---
  const originalPrice = parseFloat(offer.productPrice);
  const discountedPrice =
    offer.discountType === "percentage"
      ? originalPrice * (1 - offer.discountValue / 100)
      : originalPrice - offer.discountValue;
  const formattedOriginal = formatPrice(originalPrice);
  const formattedDiscounted = formatPrice(Math.max(0, discountedPrice));
  const discountLabel =
    offer.discountType === "percentage"
      ? `${offer.discountValue}% ${shopify.i18n.translate("off")}`
      : `${formatPrice(offer.discountValue)} ${shopify.i18n.translate("off")}`;

  return (
    <s-banner heading={offer.title}>
      <s-stack gap="base">
        {/* Product info */}
        <s-stack gap="small-100">
          <s-text type="emphasis">{offer.productTitle}</s-text>
          {offer.description && <s-text>{offer.description}</s-text>}
        </s-stack>

        {/* Pricing */}
        <s-stack direction="inline" gap="small-100" inlineAlignment="start">
          <s-text type="emphasis">{formattedDiscounted}</s-text>
          {offer.discountValue > 0 && (
            <s-text appearance="subdued">
              <s-text accessibilityRole="decorative" style="text-decoration: line-through">
                {formattedOriginal}
              </s-text>
            </s-text>
          )}
          {offer.discountValue > 0 && (
            <s-badge tone="success">{discountLabel}</s-badge>
          )}
        </s-stack>

        {/* Countdown timer */}
        {timeRemaining !== null && timeRemaining > 0 && (
          <s-text appearance="subdued">
            {shopify.i18n.translate("expiresIn", {
              time: formatTime(timeRemaining),
            })}
          </s-text>
        )}

        {/* CTA Buttons */}
        <s-stack direction="inline" gap="base">
          <s-button
            kind="primary"
            onClick={handleAccept}
            loading={accepting}
          >
            {offer.ctaText || shopify.i18n.translate("addToOrder")}
          </s-button>
          <s-button kind="secondary" onClick={handleDecline}>
            {shopify.i18n.translate("noThanks")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-banner>
  );
}

function formatPrice(amount) {
  const currency = shopify.localization?.value?.currency?.isoCode || "USD";
  const locale = shopify.localization?.value?.language?.isoCode || "en";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
