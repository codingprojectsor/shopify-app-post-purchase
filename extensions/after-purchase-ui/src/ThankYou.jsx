import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

export default async () => {
  render(<ThankYouPage />, document.body);
};

function ThankYouPage() {
  const [widgetConfig, setWidgetConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWidgetConfig();
  }, []);

  async function fetchWidgetConfig() {
    try {
      const appUrl = getAppUrl();
      if (!appUrl) { setLoading(false); return; }

      const token = await shopify.sessionToken.get();
      const response = await fetch(`${appUrl}/api/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        setWidgetConfig(await response.json());
      }
    } catch (err) {
      console.error("Widget config error:", err);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <s-box padding="small-200" borderRadius="base" borderWidth="base">
        <s-stack gap="small-200" alignItems="center">
          <s-spinner />
          <s-text color="subdued">Loading...</s-text>
        </s-stack>
      </s-box>
    );
  }

  const enabledWidgets = widgetConfig?.widgets || [{ type: "upsell" }];
  const branding = widgetConfig?.branding;
  const surveyQuestions = widgetConfig?.survey || [];

  return (
    <s-stack gap="small">
      {enabledWidgets.map((widget, idx) => {
        switch (widget.type) {
          case "upsell":
            return <UpsellWidget key={idx} branding={branding} />;
          case "social_share":
            return <SocialShareWidget key={idx} settings={widget.settings || {}} />;
          case "survey":
            return surveyQuestions.length > 0 ? (
              <SurveyWidget key={idx} questions={surveyQuestions} />
            ) : null;
          case "reorder":
            return <ReorderWidget key={idx} />;
          case "custom_message":
            return branding?.customMessage ? (
              <s-box key={idx} padding="small-200" borderRadius="base" borderWidth="base">
                <s-text type="strong">{branding.customMessage}</s-text>
              </s-box>
            ) : null;
          default:
            return null;
        }
      })}
    </s-stack>
  );
}

// ──────────────────────────────────────────
// UPSELL WIDGET
// ──────────────────────────────────────────
function UpsellWidget({ branding }) {
  const [state, setState] = useState("loading");
  const [offer, setOffer] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [funnelStep, setFunnelStep] = useState(1);
  const timerRef = useRef(null);

  useEffect(() => {
    fetchOffer();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    if (timeRemaining === null || timeRemaining <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setState("expired");
          trackEvent("decline", offer?.id, funnelStep);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timeRemaining !== null]);

  async function fetchOffer(declinedOfferId = null, step = 1) {
    try {
      const appUrl = getAppUrl();
      if (!appUrl) { setState("empty"); return; }

      const token = await shopify.sessionToken.get();
      const orderConfirmation = shopify.orderConfirmation?.value;
      if (!orderConfirmation?.order?.id) { setState("empty"); return; }

      const lines = shopify.lines?.value || [];
      const cost = shopify.cost?.totalAmount?.value;
      const orderTotal = parseFloat(String(cost?.amount || cost || "0")) || 0;

      if (declinedOfferId) setState("loading");

      const response = await fetch(`${appUrl}/api/upsell/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          orderId: orderConfirmation.order.id,
          orderNumber: orderConfirmation.number,
          lineItems: lines.map((line) => ({
            productId: line.merchandise?.product?.id,
            variantId: line.merchandise?.id,
            quantity: line.quantity,
          })),
          orderTotal,
          totalQuantity: lines.reduce((sum, l) => sum + (l.quantity || 1), 0),
          shippingCountry: shopify.shippingAddress?.value?.countryCode || "",
          declinedOfferId,
          funnelStep: step,
        }),
      });

      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      const data = await response.json();
      if (!data.offer) { setState("empty"); return; }

      setOffer(data.offer);
      setFunnelStep(data.offer.funnelStep || step);
      setState("offer");

      if (timerRef.current) clearInterval(timerRef.current);
      if (data.offer.timeLimitMinutes) {
        setTimeRemaining(data.offer.timeLimitMinutes * 60);
      } else {
        setTimeRemaining(null);
      }

      trackEvent("view", data.offer.id, data.offer.funnelStep || step);
    } catch (err) {
      setState("error");
    }
  }

  async function trackEvent(eventType, offerId, step) {
    try {
      const appUrl = getAppUrl();
      if (!appUrl) return;
      const token = await shopify.sessionToken.get();
      await fetch(`${appUrl}/api/upsell/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offerId: offerId || offer?.id, eventType, funnelStep: step || funnelStep }),
      });
    } catch (_) { /* silent */ }
  }

  const handleAccept = useCallback(async () => {
    if (accepting) return;
    setAccepting(true);
    try {
      const appUrl = getAppUrl();
      if (!appUrl) throw new Error("No app URL");
      const token = await shopify.sessionToken.get();
      const orderConfirmation = shopify.orderConfirmation?.value;

      const response = await fetch(`${appUrl}/api/upsell/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offerId: offer.id, orderId: orderConfirmation.order.id, funnelStep }),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Failed");

      if (timerRef.current) clearInterval(timerRef.current);
      setState("accepted");
    } catch (err) {
      setAccepting(false);
    }
  }, [offer, accepting, funnelStep]);

  const handleDecline = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    trackEvent("decline", offer?.id, funnelStep);
    if (offer?.hasFallback) {
      fetchOffer(offer.id, funnelStep + 1);
    } else {
      setState("declined");
    }
  }, [offer, funnelStep]);

  // --- Render states ---
  if (state === "loading") {
    return (
      <s-box padding="small-200" borderRadius="base" borderWidth="base">
        <s-stack gap="small-200" alignItems="center">
          <s-spinner />
          <s-text color="subdued">{shopify.i18n.translate("loading")}</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (state === "empty" || state === "declined" || state === "error") return null;

  if (state === "expired") {
    return (
      <s-box padding="small-200" borderRadius="base" borderWidth="base">
        <s-stack gap="small-200">
          <s-text type="strong">{shopify.i18n.translate("offerExpiredTitle")}</s-text>
          <s-text color="subdued">{shopify.i18n.translate("offerExpired")}</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (state === "accepted") {
    return (
      <s-banner heading={shopify.i18n.translate("acceptedTitle")} tone="success">
        <s-text>{shopify.i18n.translate("acceptedMessage", { product: offer.productTitle })}</s-text>
      </s-banner>
    );
  }

  // --- Offer display ---
  const originalPrice = parseFloat(offer.productPrice);
  const discountedPrice = offer.discountType === "percentage"
    ? originalPrice * (1 - offer.discountValue / 100)
    : originalPrice - offer.discountValue;
  const formattedOriginal = formatPrice(originalPrice);
  const formattedDiscounted = formatPrice(Math.max(0, discountedPrice));
  const savings = Math.max(0, originalPrice - Math.max(0, discountedPrice));
  const discountLabel = offer.discountType === "percentage"
    ? `${offer.discountValue}% ${shopify.i18n.translate("off")}`
    : `${formatPrice(offer.discountValue)} ${shopify.i18n.translate("off")}`;
  const timerPercent = timeRemaining !== null && offer.timeLimitMinutes
    ? Math.max(0, (timeRemaining / (offer.timeLimitMinutes * 60)) * 100) : 0;

  return (
    <s-box padding="small-200" borderRadius="base" borderWidth="base">
      <s-stack gap="small-200">
        {/* Badge row */}
        <s-stack direction="inline" gap="small-100">
          <s-badge>
            {funnelStep > 1 ? shopify.i18n.translate("specialDeal") : shopify.i18n.translate("exclusiveOffer")}
          </s-badge>
          {offer.discountValue > 0 && <s-badge>{discountLabel}</s-badge>}
        </s-stack>

        {/* Title + description */}
        <s-text type="strong">{offer.title}</s-text>
        {offer.description && <s-text color="subdued">{offer.description}</s-text>}

        {/* Product row: name + price inline */}
        <s-box padding="small-200" borderRadius="base" background="subdued">
          <s-stack gap="small-100">
            <s-stack direction="inline" gap="small-200">
              <s-text type="strong">{offer.productTitle}</s-text>
            </s-stack>
            <s-stack direction="inline" gap="small-100">
              <s-text type="strong">{formattedDiscounted}</s-text>
              {offer.discountValue > 0 && (
                <s-text color="subdued">{formattedOriginal}</s-text>
              )}
              {savings > 0 && (
                <s-text color="subdued">
                  ({shopify.i18n.translate("youSave", { amount: formatPrice(savings) })})
                </s-text>
              )}
            </s-stack>
          </s-stack>
        </s-box>

        {/* Timer bar */}
        {timeRemaining !== null && timeRemaining > 0 && (
          <s-stack gap="small-100">
            <s-text color="subdued">
              {shopify.i18n.translate("expiresIn", { time: formatTime(timeRemaining) })}
            </s-text>
            <s-box borderRadius="small" background="subdued" blockSize="3px" overflow="hidden">
              <s-box borderRadius="small" background="base" blockSize="3px" inlineSize={`${timerPercent}%`} />
            </s-box>
          </s-stack>
        )}

        {/* Trust signals */}
        {(branding?.showTrustBadges !== false) && (
          <s-stack direction="inline" gap="small-200">
            <s-text color="subdued">{shopify.i18n.translate("oneClick")}</s-text>
            <s-text color="subdued">{shopify.i18n.translate("secureCheckout")}</s-text>
          </s-stack>
        )}

        {/* CTA Buttons */}
        <s-stack direction="inline" gap="small-200">
          <s-button variant="primary" onClick={handleAccept} loading={accepting}>
            {offer.ctaText || shopify.i18n.translate("addToOrder")}
          </s-button>
          <s-button variant="secondary" onClick={handleDecline}>
            {shopify.i18n.translate("noThanks")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

// ──────────────────────────────────────────
// SOCIAL SHARE WIDGET
// ──────────────────────────────────────────
function SocialShareWidget({ settings }) {
  const shopDomain = shopify.shop?.myshopifyDomain || "";
  const shopUrl = shopDomain ? `https://${shopDomain}` : "";
  const shareText = settings?.shareMessage || "I just bought something awesome! Check this store out:";

  // Share intent URLs — always open compose/share dialogs
  const shareUrls = {
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shopUrl)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shopUrl)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText + " " + shopUrl)}`,
  };

  return (
    <s-box padding="small-200" borderRadius="base" borderWidth="base">
      <s-stack gap="small-200">
        {/* Share buttons */}
        <s-text type="strong">{shopify.i18n.translate("shareTitle")}</s-text>
        <s-text color="subdued">{shopify.i18n.translate("shareDescription")}</s-text>
        <s-stack direction="inline" gap="small-200">
          <s-button variant="secondary" href={shareUrls.twitter} target="_blank">𝕏 Share</s-button>
          <s-button variant="secondary" href={shareUrls.facebook} target="_blank">f Share</s-button>
          <s-button variant="secondary" href={shareUrls.whatsapp} target="_blank">✆ Share</s-button>
        </s-stack>

      </s-stack>
    </s-box>
  );
}

// ──────────────────────────────────────────
// SURVEY WIDGET
// ──────────────────────────────────────────
function SurveyWidget({ questions }) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState(0);
  const [textAnswer, setTextAnswer] = useState("");

  async function submitAnswer(questionId, answer) {
    try {
      const appUrl = getAppUrl();
      if (!appUrl) return;
      const token = await shopify.sessionToken.get();
      const orderConfirmation = shopify.orderConfirmation?.value;
      await fetch(`${appUrl}/api/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          intent: "survey_response",
          questionId,
          answer: String(answer),
          orderId: orderConfirmation?.order?.id,
        }),
      });
    } catch (_) { /* silent */ }
  }

  function handleNext() {
    const q = questions[currentIdx];
    const answer = q.type === "rating" ? rating : textAnswer;
    if (!answer) return;

    submitAnswer(q.id, answer);
    setAnswers({ ...answers, [q.id]: answer });

    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setRating(0);
      setTextAnswer("");
    } else {
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <s-box padding="small-200" borderRadius="base" borderWidth="base">
        <s-stack gap="small-200" alignItems="center">
          <s-text type="strong">{shopify.i18n.translate("surveyThanks")}</s-text>
          <s-text color="subdued">{shopify.i18n.translate("surveyHelps")}</s-text>
        </s-stack>
      </s-box>
    );
  }

  const q = questions[currentIdx];

  return (
    <s-box padding="small-200" borderRadius="base" borderWidth="base">
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200">
          <s-badge>{currentIdx + 1}/{questions.length}</s-badge>
          <s-text type="strong">{shopify.i18n.translate("quickSurvey")}</s-text>
        </s-stack>

        <s-text>{q.question}</s-text>

        {q.type === "rating" && (
          <s-stack direction="inline" gap="small-100">
            {[1, 2, 3, 4, 5].map((star) => (
              <s-button
                key={star}
                variant={rating >= star ? "primary" : "secondary"}
                onClick={() => setRating(star)}
              >
                {star}
              </s-button>
            ))}
          </s-stack>
        )}

        {q.type === "text" && (
          <s-text-field
            label="Your answer"
            value={textAnswer}
            onChange={(e) => setTextAnswer(/** @type {any} */ (e).target.value)}
          />
        )}

        {q.type === "multiple_choice" && (
          <s-stack direction="inline" gap="small-100">
            {q.options.map((opt) => (
              <s-button
                key={opt}
                variant={textAnswer === opt ? "primary" : "secondary"}
                onClick={() => setTextAnswer(opt)}
              >
                {opt}
              </s-button>
            ))}
          </s-stack>
        )}

        <s-stack direction="inline" gap="small-200">
          {currentIdx > 0 && (
            <s-button variant="secondary" onClick={() => { setCurrentIdx(currentIdx - 1); setRating(0); setTextAnswer(""); }}>
              {shopify.i18n.translate("previous")}
            </s-button>
          )}
          <s-button variant="primary" onClick={handleNext}>
            {currentIdx < questions.length - 1
              ? shopify.i18n.translate("next")
              : shopify.i18n.translate("submit")}
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

// ──────────────────────────────────────────
// REORDER WIDGET
// ──────────────────────────────────────────
function ReorderWidget() {
  const shopDomain = shopify.shop?.myshopifyDomain || "";
  const lines = shopify.lines?.value || [];

  // Build Shopify cart URL: /cart/variant_id:qty,variant_id:qty
  // This pre-fills the cart with the same items from this order
  const variantIds = lines
    .map((line) => {
      const variantGid = line.merchandise?.id || "";
      // Extract numeric ID from gid://shopify/ProductVariant/123
      const numericId = variantGid.split("/").pop();
      return numericId ? `${numericId}:${line.quantity || 1}` : null;
    })
    .filter(Boolean);

  const reorderUrl = variantIds.length > 0
    ? `https://${shopDomain}/cart/${variantIds.join(",")}`
    : `https://${shopDomain}`;

  return (
    <s-box padding="small-200" borderRadius="base" borderWidth="base">
      <s-stack gap="small-200">
        <s-text type="strong">{shopify.i18n.translate("reorderTitle")}</s-text>
        <s-text color="subdued">{shopify.i18n.translate("reorderDescription")}</s-text>
        <s-button variant="secondary" href={reorderUrl} target="_blank">
          {shopify.i18n.translate("reorderButton")}
        </s-button>
      </s-stack>
    </s-box>
  );
}

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────
function getAppUrl() {
  const settings = shopify.settings?.value;
  if (settings?.app_url) return String(settings.app_url).replace(/\/+$/, "");

  const metafields = shopify.appMetafields?.value || [];
  const metafield = metafields.find(
    (m) => m.metafield?.namespace === "$app" && m.metafield?.key === "app_url",
  );
  if (metafield?.metafield?.value) return String(metafield.metafield.value).replace(/\/+$/, "");

  return "";
}

function formatPrice(amount) {
  const loc = /** @type {any} */ (shopify.localization);
  const locVal = loc?.value || loc || {};
  const currency = locVal?.currency?.isoCode || "USD";
  const locale = locVal?.language?.isoCode || "en";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
