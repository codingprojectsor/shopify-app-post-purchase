import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";

export default async () => {
  render(<ThankYouPage />, document.body);
};

// ──────────────────────────────────────────
// MAIN PAGE
// ──────────────────────────────────────────
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
      <s-box padding="small-300" borderRadius="base" borderWidth="base">
        <s-stack gap="small-100" alignItems="center">
          <s-spinner />
          <s-text color="subdued">{shopify.i18n.translate("loading")}</s-text>
        </s-stack>
      </s-box>
    );
  }

  const enabledWidgets = widgetConfig?.widgets || [{ type: "upsell" }];
  const branding = widgetConfig?.branding;
  const surveyQuestions = widgetConfig?.survey || [];

  return (
    <s-stack gap="small-200">
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
              <CustomMessageWidget key={idx} message={branding.customMessage} />
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

  // ── Loading state ──
  if (state === "loading") {
    return (
      <s-box padding="small-200" borderRadius="base" borderWidth="base">
        <s-stack gap="small-100" alignItems="center">
          <s-spinner />
          <s-text color="subdued">{shopify.i18n.translate("loading")}</s-text>
        </s-stack>
      </s-box>
    );
  }

  if (state === "empty" || state === "declined" || state === "error") return null;

  // ── Expired state ──
  if (state === "expired") {
    return (
      <s-box padding="small-200" borderRadius="base" borderWidth="base">
        <s-stack gap="small-100" alignItems="center">
          <s-icon type="clock" size="large" tone="critical" />
          <s-heading>{shopify.i18n.translate("offerExpiredTitle")}</s-heading>
          <s-text color="subdued">{shopify.i18n.translate("offerExpired")}</s-text>
        </s-stack>
      </s-box>
    );
  }

  // ── Accepted state ──
  if (state === "accepted") {
    return (
      <s-banner heading={shopify.i18n.translate("acceptedTitle")} tone="success">
        <s-text>{shopify.i18n.translate("acceptedMessage", { product: offer.productTitle })}</s-text>
      </s-banner>
    );
  }

  // ── Offer display ──
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
  const isUrgent = timeRemaining !== null && timeRemaining < 60;

  // Extension settings (configurable from theme editor)
  const extensionSettings = shopify.settings?.value || {};
  const buttonLayout = String(extensionSettings.button_layout || "") === "stacked" ? "stacked" : "side-by-side";
  const declineText = String(extensionSettings.decline_text || "") || shopify.i18n.translate("noThanks");
  const hidDecline = extensionSettings.hide_decline === true;
  const acceptTone = /** @type {"auto" | "critical"} */ (
    String(extensionSettings.accept_tone || "") === "critical" ? "critical" : "auto"
  );

  return (
    <s-box borderRadius="base" borderWidth="base" overflow="hidden">
      <s-stack gap="none">

        {/* ── Header banner ── */}
        <s-box padding="small-200 small-300" background="subdued">
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <s-stack direction="inline" gap="small-100" alignItems="center">
              <s-icon type={funnelStep > 1 ? "star-filled" : "discount"} size="small" />
              <s-heading>
                {funnelStep > 1
                  ? shopify.i18n.translate("specialDeal")
                  : shopify.i18n.translate("exclusiveOffer")}
              </s-heading>
            </s-stack>
            <s-stack direction="inline" gap="small-100">
              {offer.discountValue > 0 && (
                <s-badge tone="critical" icon="savings">{discountLabel}</s-badge>
              )}
              {timeRemaining !== null && timeRemaining > 0 && (
                <s-badge tone="critical" icon="clock">{shopify.i18n.translate("limitedTime")}</s-badge>
              )}
            </s-stack>
          </s-stack>
        </s-box>

        {/* ── Title & description ── */}
        <s-box padding="small-200 small-300">
          <s-stack gap="small-100">
            <s-text type="strong">{offer.title}</s-text>
            {offer.description && (
              <s-text color="subdued">{offer.description}</s-text>
            )}
          </s-stack>
        </s-box>

        {/* ── Product card ── */}
        <s-box paddingInline="small-300" paddingBlock="small-100">
          <s-box padding="small-200" borderRadius="base" borderWidth="base" background="subdued">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {offer.productImage && (
                <s-product-thumbnail
                  src={offer.productImage}
                  alt={offer.productTitle}
                  size="base"
                />
              )}
              <s-stack gap="small-100">
                <s-text type="strong">{offer.productTitle}</s-text>
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-text type="strong">{formattedDiscounted}</s-text>
                  {offer.discountValue > 0 && (
                    <s-text color="subdued">{formattedOriginal}</s-text>
                  )}
                </s-stack>
                {savings > 0 && (
                  <s-badge icon="savings">
                    {shopify.i18n.translate("youSave", { amount: formatPrice(savings) })}
                  </s-badge>
                )}
              </s-stack>
            </s-stack>
          </s-box>
        </s-box>

        {/* ── Countdown timer ── */}
        {timeRemaining !== null && timeRemaining > 0 && (
          <s-box paddingInline="small-300" paddingBlock="small-100">
            <s-stack gap="small-100">
              <s-stack direction="inline" gap="small-100" alignItems="center" justifyContent="space-between">
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-icon type="clock" size="small-200" tone={isUrgent ? "critical" : "auto"} />
                  <s-text color="subdued" type="strong">
                    {shopify.i18n.translate("expiresIn", { time: formatTime(timeRemaining) })}
                  </s-text>
                </s-stack>
                {isUrgent && <s-badge tone="critical" icon="alert-circle">{shopify.i18n.translate("hurry")}</s-badge>}
              </s-stack>
              <s-progress
                value={timerPercent}
                max={100}
                tone={isUrgent ? "critical" : "auto"}
                accessibilityLabel={shopify.i18n.translate("expiresIn", { time: formatTime(timeRemaining) })}
              />
            </s-stack>
          </s-box>
        )}

        {/* ── Trust signals ── */}
        {(branding?.showTrustBadges !== false) && (
          <s-box paddingInline="small-300" paddingBlock="small-100">
            <s-stack direction="inline" gap="small-300" justifyContent="center" alignItems="center">
              <s-stack direction="inline" gap="small-100" alignItems="center">
                <s-icon type="cart" size="small-200" />
                <s-text color="subdued">{shopify.i18n.translate("oneClick")}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="small-100" alignItems="center">
                <s-icon type="lock" size="small-200" />
                <s-text color="subdued">{shopify.i18n.translate("secureCheckout")}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="small-100" alignItems="center">
                <s-icon type="check-circle" size="small-200" />
                <s-text color="subdued">{shopify.i18n.translate("moneyBack")}</s-text>
              </s-stack>
            </s-stack>
          </s-box>
        )}

        {/* ── CTA Buttons ── */}
        <s-box paddingInline="small-300" paddingBlock="small-200">
          {hidDecline ? (
            <s-grid gridTemplateColumns="1fr 1fr" gap="small-100" alignItems="center">
              <s-box />
              <s-button variant="primary" inlineSize="fill" tone={acceptTone} onClick={handleAccept} loading={accepting}>
                {offer.ctaText || shopify.i18n.translate("addToOrder")}
              </s-button>
            </s-grid>
          ) : buttonLayout === "stacked" ? (
            <s-stack gap="small-100">
              <s-button variant="primary" inlineSize="fill" tone={acceptTone} onClick={handleAccept} loading={accepting}>
                {offer.ctaText || shopify.i18n.translate("addToOrder")}
              </s-button>
              <s-button variant="secondary" inlineSize="fill" onClick={handleDecline}>
                {declineText}
              </s-button>
            </s-stack>
          ) : (
            <s-grid gridTemplateColumns="1fr 1fr" gap="small-100" alignItems="center">
              <s-button variant="primary" inlineSize="fill" tone={acceptTone} onClick={handleAccept} loading={accepting}>
                {offer.ctaText || shopify.i18n.translate("addToOrder")}
              </s-button>
              <s-button variant="secondary" inlineSize="fill" onClick={handleDecline}>
                {declineText}
              </s-button>
            </s-grid>
          )}
        </s-box>

      </s-stack>
    </s-box>
  );
}

// ──────────────────────────────────────────
// SOCIAL SHARE WIDGET
// ──────────────────────────────────────────
function SocialShareWidget({ settings }) {
  const shopDomain = shopify.shop?.myshopifyDomain || "";
  const lines = shopify.lines?.value || [];
  const productTitle = lines[0]?.merchandise?.title || "";
  const productHandle = productTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const shareUrl = productHandle && shopDomain
    ? `https://${shopDomain}/products/${productHandle}`
    : shopDomain ? `https://${shopDomain}` : "";

  const shareText = settings?.shareMessage
    || (productTitle ? `I just bought ${productTitle}! Check it out:` : "I just bought something awesome! Check this store out:");

  const shareUrls = {
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText + " " + shareUrl)}`,
  };

  return (
    <s-box borderRadius="base" borderWidth="base" overflow="hidden">
      <s-stack gap="none">
        <s-box padding="small-200 small-300" background="subdued">
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-icon type="globe" size="small" />
            <s-heading>{shopify.i18n.translate("shareTitle")}</s-heading>
          </s-stack>
        </s-box>
        <s-box padding="small-200 small-300">
          <s-stack gap="small-200">
            <s-text color="subdued">{shopify.i18n.translate("shareDescription")}</s-text>
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="small-100">
              <s-button variant="secondary" inlineSize="fill" href={shareUrls.twitter} target="_blank">
                X
              </s-button>
              <s-button variant="secondary" inlineSize="fill" href={shareUrls.facebook} target="_blank">
                Facebook
              </s-button>
              <s-button variant="secondary" inlineSize="fill" href={shareUrls.whatsapp} target="_blank">
                WhatsApp
              </s-button>
            </s-grid>
          </s-stack>
        </s-box>
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
      <s-box borderRadius="base" borderWidth="base" padding="small-300">
        <s-stack gap="small-100" alignItems="center">
          <s-icon type="check-circle-filled" size="large" tone="success" />
          <s-heading>{shopify.i18n.translate("surveyThanks")}</s-heading>
          <s-text color="subdued">{shopify.i18n.translate("surveyHelps")}</s-text>
        </s-stack>
      </s-box>
    );
  }

  const q = questions[currentIdx];

  return (
    <s-box borderRadius="base" borderWidth="base" overflow="hidden">
      <s-stack gap="none">
        {/* Header */}
        <s-box padding="small-200 small-300" background="subdued">
          <s-stack direction="inline" gap="small-100" alignItems="center" justifyContent="space-between">
            <s-stack direction="inline" gap="small-100" alignItems="center">
              <s-icon type="note" size="small" />
              <s-heading>{shopify.i18n.translate("quickSurvey")}</s-heading>
            </s-stack>
            <s-badge>{currentIdx + 1}/{questions.length}</s-badge>
          </s-stack>
        </s-box>

        {/* Progress */}
        <s-progress
          value={currentIdx + 1}
          max={questions.length}
          accessibilityLabel={`Question ${currentIdx + 1} of ${questions.length}`}
        />

        {/* Question */}
        <s-box padding="small-200 small-300">
          <s-stack gap="small-200">
            <s-text type="strong">{q.question}</s-text>

            {/* Rating stars */}
            {q.type === "rating" && (
              <s-stack direction="inline" gap="small-100">
                {[1, 2, 3, 4, 5].map((star) => (
                  <s-clickable key={star} onClick={() => setRating(star)}>
                    <s-icon type={rating >= star ? "star-filled" : "star"} size="large" tone={rating >= star ? "info" : "auto"} />
                  </s-clickable>
                ))}
              </s-stack>
            )}

            {/* Text input */}
            {q.type === "text" && (
              <s-text-field
                label={shopify.i18n.translate("surveyPlaceholder")}
                value={textAnswer}
                onChange={(e) => setTextAnswer(/** @type {any} */(e).target.value)}
              />
            )}

            {/* Multiple choice */}
            {q.type === "multiple_choice" && (
              <s-stack direction="inline" gap="small-100">
                {q.options.map((opt) => (
                  <s-button
                    key={opt}
                    variant={textAnswer === opt ? "primary" : "secondary"}
                    onClick={() => setTextAnswer(opt)}
                  >
                    {textAnswer === opt ? `\u2713 ${opt}` : opt}
                  </s-button>
                ))}
              </s-stack>
            )}
          </s-stack>
        </s-box>

        {/* Navigation */}
        <s-divider />
        <s-box paddingInline="small-300" paddingBlock="small-200">
          <s-grid gridTemplateColumns="1fr 1fr" gap="small-100" alignItems="center">
            {currentIdx > 0 ? (
              <s-button variant="secondary" inlineSize="fill" onClick={() => { setCurrentIdx(currentIdx - 1); setRating(0); setTextAnswer(""); }}>
                {shopify.i18n.translate("previous")}
              </s-button>
            ) : <s-box />}
            <s-button variant="primary" inlineSize="fill" onClick={handleNext}>
              {currentIdx < questions.length - 1
                ? shopify.i18n.translate("next")
                : shopify.i18n.translate("submit")}
            </s-button>
          </s-grid>
        </s-box>
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

  const variantIds = lines
    .map((line) => {
      const variantGid = line.merchandise?.id || "";
      const numericId = variantGid.split("/").pop();
      return numericId ? `${numericId}:${line.quantity || 1}` : null;
    })
    .filter(Boolean);

  const reorderUrl = variantIds.length > 0
    ? `https://${shopDomain}/cart/${variantIds.join(",")}`
    : `https://${shopDomain}`;

  return (
    <s-box borderRadius="base" borderWidth="base" overflow="hidden">
      <s-stack gap="none">
        <s-box padding="small-200 small-300" background="subdued">
          <s-stack direction="inline" gap="small-100" alignItems="center">
            <s-icon type="reorder" size="small" />
            <s-heading>{shopify.i18n.translate("reorderTitle")}</s-heading>
          </s-stack>
        </s-box>
        <s-box padding="small-200 small-300">
          <s-stack gap="small-200">
            <s-text color="subdued">{shopify.i18n.translate("reorderDescription")}</s-text>
            <s-grid gridTemplateColumns="1fr 1fr" gap="small-100" alignItems="center">
              <s-box />
              <s-button variant="secondary" inlineSize="fill" href={reorderUrl} target="_blank">
                {shopify.i18n.translate("reorderButton")}
              </s-button>
            </s-grid>
          </s-stack>
        </s-box>
      </s-stack>
    </s-box>
  );
}

// ──────────────────────────────────────────
// CUSTOM MESSAGE WIDGET
// ──────────────────────────────────────────
function CustomMessageWidget({ message }) {
  return (
    <s-box borderRadius="base" borderWidth="base" padding="small-200 small-300">
      <s-stack direction="inline" gap="small-100" alignItems="center">
        <s-icon type="info" size="small" />
        <s-text type="strong">{message}</s-text>
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
