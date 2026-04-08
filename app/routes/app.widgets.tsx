import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { usePlanLimits } from "../hooks/usePlanLimits";
import { UpgradeBanner } from "../components/UpgradeBanner";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type {
  ActionFunctionArgs,
  HeadersArgs,
  LoaderFunctionArgs,
} from "react-router";

const DEFAULT_WIDGETS = [
  { widgetType: "upsell", label: "Upsell Offer", icon: "cart-sale" },
  { widgetType: "social_share", label: "Social Share Buttons", icon: "share" },
  { widgetType: "survey", label: "Post-Purchase Survey", icon: "forms" },
  { widgetType: "reorder", label: "Reorder Button", icon: "order-repeat" },
  {
    widgetType: "custom_message",
    label: "Custom Thank-You Message",
    icon: "note",
  },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const widgets = await db.widgetConfig.findMany({
    where: { shop: session.shop },
    orderBy: { position: "asc" },
  });

  const branding = await db.brandingConfig.findFirst({
    where: { shop: session.shop },
  });

  const surveyQuestions = await db.surveyQuestion.findMany({
    where: { shop: session.shop },
    orderBy: { position: "asc" },
  });

  // Survey responses summary
  const surveyResponses = await db.surveyResponse.findMany({
    where: { shop: session.shop },
    include: { question: { select: { question: true } } },
  });

  return {
    widgets,
    branding,
    surveyQuestions,
    surveyResponseCount: surveyResponses.length,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Toggle widget
  if (intent === "toggle_widget") {
    const widgetType = formData.get("widgetType") as string;
    const enabled = formData.get("enabled") === "true";

    await db.widgetConfig.upsert({
      where: { shop_widgetType: { shop: session.shop, widgetType } },
      update: { enabled },
      create: {
        shop: session.shop,
        widgetType,
        enabled,
        position:
          (await db.widgetConfig.count({ where: { shop: session.shop } })) + 1,
      },
    });
    return { success: true };
  }

  // Move widget up/down
  if (intent === "move_widget") {
    const widgetType = formData.get("widgetType") as string;
    const direction = formData.get("direction") as string; // "up" | "down"

    const widgets = await db.widgetConfig.findMany({
      where: { shop: session.shop },
      orderBy: { position: "asc" },
    });

    const idx = widgets.findIndex((w) => w.widgetType === widgetType);
    if (idx === -1) return { success: false };

    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= widgets.length) return { success: false };

    // Swap positions
    await db.$transaction([
      db.widgetConfig.update({
        where: { id: widgets[idx].id },
        data: { position: widgets[swapIdx].position },
      }),
      db.widgetConfig.update({
        where: { id: widgets[swapIdx].id },
        data: { position: widgets[idx].position },
      }),
    ]);
    return { success: true };
  }

  // Save branding
  if (intent === "save_branding") {
    const primaryColor = formData.get("primaryColor") as string;
    const accentColor = formData.get("accentColor") as string;
    const buttonStyle = formData.get("buttonStyle") as string;
    const showTrustBadges = formData.get("showTrustBadges") === "true";
    const customMessage = formData.get("customMessage") as string;

    await db.brandingConfig.upsert({
      where: { shop: session.shop },
      update: {
        primaryColor,
        accentColor,
        buttonStyle,
        showTrustBadges,
        customMessage,
      },
      create: {
        shop: session.shop,
        primaryColor,
        accentColor,
        buttonStyle,
        showTrustBadges,
        customMessage,
      },
    });
    return { success: true, brandingSaved: true };
  }

  // Add survey question
  if (intent === "add_question") {
    const question = formData.get("question") as string;
    const questionType = formData.get("questionType") as string;
    const options = formData.get("options") as string;

    if (!question) return { error: "Question is required" };

    const count = await db.surveyQuestion.count({
      where: { shop: session.shop },
    });

    await db.surveyQuestion.create({
      data: {
        shop: session.shop,
        question,
        questionType: questionType || "rating",
        options: options || "[]",
        position: count,
      },
    });
    return { success: true, questionAdded: true };
  }

  // Delete survey question
  if (intent === "delete_question") {
    const questionId = formData.get("questionId") as string;
    await db.surveyQuestion.deleteMany({
      where: { id: questionId, shop: session.shop },
    });
    return { success: true };
  }

  // Widget-specific settings
  if (intent === "save_widget_settings") {
    const widgetType = formData.get("widgetType") as string;
    const settings = formData.get("settings") as string;

    await db.widgetConfig.upsert({
      where: { shop_widgetType: { shop: session.shop, widgetType } },
      update: { settings },
      create: {
        shop: session.shop,
        widgetType,
        settings,
        enabled: true,
        position:
          (await db.widgetConfig.count({ where: { shop: session.shop } })) + 1,
      },
    });
    return { success: true };
  }

  return { success: false };
};

export default function WidgetsPage() {
  const { widgets, branding, surveyQuestions, surveyResponseCount } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher(); // for settings save only
  const widgetFetcher = useFetcher(); // for move/toggle (quick actions)
  const shopify = useAppBridge();
  const { limits, currentPlan } = usePlanLimits();

  if (!limits.customBranding) {
    return (
      <s-page heading="Widgets & Branding">
        <s-section>
          <UpgradeBanner feature="Custom Widgets & Branding" currentPlan={currentPlan} />
        </s-section>
      </s-page>
    );
  }
  const questionModalRef = useRef<any>(null);

  // Branding state
  const primaryColor = branding?.primaryColor || "#000000";
  const accentColor = branding?.accentColor || "#22c55e";
  const buttonStyle = branding?.buttonStyle || "rounded";
  const [showTrustBadges, setShowTrustBadges] = useState(
    branding?.showTrustBadges ?? true,
  );
  const [customMessage, setCustomMessage] = useState(
    branding?.customMessage || "",
  );

  // Survey question state
  // Share message state (from social_share widget settings)
  const socialWidget = widgets.find((w) => w.widgetType === "social_share");
  const socialSettings = socialWidget?.settings
    ? (() => { try { return JSON.parse(socialWidget.settings); } catch { return {}; } })()
    : {};
  const [shareMessage, setShareMessage] = useState(
    socialSettings?.shareMessage || "",
  );

  const [newQuestion, setNewQuestion] = useState("");
  const [newQuestionType, setNewQuestionType] = useState("rating");
  const [newOptions, setNewOptions] = useState("");

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      typeof fetcher.data === "object"
    ) {
      if ("success" in fetcher.data) shopify.toast.show("Saved successfully");
      if ("brandingSaved" in fetcher.data) shopify.toast.show("Display settings saved");
      if ("questionAdded" in fetcher.data) {
        shopify.toast.show("Question added");
        questionModalRef.current?.hideOverlay();
        setNewQuestion("");
        setNewOptions("");
      }
      if ("error" in fetcher.data)
        shopify.toast.show(fetcher.data.error as string);
    }
  }, [fetcher.state, fetcher.data, shopify]);

  // Build widget list with defaults
  const widgetList = DEFAULT_WIDGETS.map((def) => {
    const existing = widgets.find((w) => w.widgetType === def.widgetType);
    let settings = {};
    if (existing?.settings) {
      try { settings = JSON.parse(existing.settings); } catch { /* ignore */ }
    }
    return {
      ...def,
      enabled: existing?.enabled ?? false,
      position: existing?.position ?? 99,
      settings,
    };
  }).sort((a, b) => a.position - b.position);

  return (
    <s-page heading="Thank-You Page Widgets">
      {/* Breadcrumb */}
      <s-box paddingBlockEnd="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-link href="/app">
            <s-icon type="arrow-left" size="small" />
          </s-link>
          <s-link href="/app">Offers</s-link>
          <s-text color="subdued">/</s-text>
          <s-text color="subdued">Widgets</s-text>
        </s-stack>
      </s-box>

      {/* Widgets — drag handle style */}
      <s-section heading="Thank-You Page Widgets">
        <s-stack gap="small-200">
          {widgetList.map((widget, idx) => (
            <s-box
              key={widget.widgetType}
              padding="small-200"
              borderWidth="base"
              borderRadius="base"
            >
              <s-grid gridTemplateColumns="auto auto 1fr auto" gap="small-200" alignItems="center">
                {/* Drag handle / position arrows */}
                <s-grid-item>
                  <s-stack direction="inline" gap="small-100">
                    <s-button
                      variant="tertiary"
                      icon="caret-up"
                      disabled={idx === 0 || widgetFetcher.state !== "idle" || undefined}
                      accessibilityLabel="Move up"
                      onClick={() =>
                        widgetFetcher.submit(
                          { intent: "move_widget", widgetType: widget.widgetType, direction: "up" },
                          { method: "POST" },
                        )
                      }
                    />
                    <s-button
                      variant="tertiary"
                      icon="caret-down"
                      disabled={idx === widgetList.length - 1 || widgetFetcher.state !== "idle" || undefined}
                      accessibilityLabel="Move down"
                      onClick={() =>
                        widgetFetcher.submit(
                          { intent: "move_widget", widgetType: widget.widgetType, direction: "down" },
                          { method: "POST" },
                        )
                      }
                    />
                  </s-stack>
                </s-grid-item>

                {/* Toggle */}
                <s-grid-item>
                  <s-switch
                    checked={widget.enabled}
                    label={widget.label}
                    labelAccessibilityVisibility="exclusive"
                    disabled={widgetFetcher.state !== "idle" || undefined}
                    onChange={() =>
                      widgetFetcher.submit(
                        { intent: "toggle_widget", widgetType: widget.widgetType, enabled: String(!widget.enabled) },
                        { method: "POST" },
                      )
                    }
                  />
                </s-grid-item>

                {/* Icon + Label */}
                <s-grid-item>
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-icon type={widget.icon as any} color="subdued" size="small" />
                    <s-text type="strong">{widget.label}</s-text>
                  </s-stack>
                </s-grid-item>

                {/* Position badge */}
                <s-grid-item>
                  <s-badge>{idx + 1}</s-badge>
                </s-grid-item>
              </s-grid>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      {/* Social Share Config */}
      <s-section heading="Social Share Settings">
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="share" color="subdued" size="small" />
              <s-text type="strong">Share your purchase</s-text>
            </s-stack>
            <s-divider />
            <s-text color="subdued">
              Customers can share their purchase with friends on social media.
              The share buttons open a compose window with your message + store
              URL pre-filled.
            </s-text>

            <s-text-field
              label="Share message"
              value={shareMessage}
              onChange={(e: any) => setShareMessage(e.target.value)}
            />
            <s-text color="subdued">
              Default: "I just bought something awesome! Check this store out:"
            </s-text>

            <s-button
              icon="save"
              loading={fetcher.state !== "idle" || undefined}
              onClick={() =>
                fetcher.submit(
                  {
                    intent: "save_widget_settings",
                    widgetType: "social_share",
                    settings: JSON.stringify({ shareMessage }),
                  },
                  { method: "POST" },
                )
              }
            >
              Save share settings
            </s-button>
          </s-stack>
        </s-box>
      </s-section>

      {/* Display Settings */}
      <s-section heading="Display Settings">
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="theme-edit" color="subdued" size="small" />
              <s-text type="strong">Content & Layout</s-text>
            </s-stack>
            <s-divider />

            <s-stack direction="inline" gap="base" alignItems="center">
              <s-switch
                checked={showTrustBadges}
                onChange={(e: any) => setShowTrustBadges(e.target.checked)}
                label="Trust badges"
                labelAccessibilityVisibility="exclusive"
              />
              <s-stack gap="small-100">
                <s-text type="strong">Show trust badges</s-text>
                <s-text color="subdued">
                  "One-click add" and "Secure checkout" below the upsell
                </s-text>
              </s-stack>
            </s-stack>

            <s-divider />

            <s-text-area
              label="Custom Thank-You Message (shown above all widgets)"
              value={customMessage}
              onChange={(e: any) => setCustomMessage(e.target.value)}
              rows={2}
            />

            <s-banner tone="info">
              <s-text>
                Colors and fonts auto-match your checkout theme. Change them in
                Shopify Admin &gt; Settings &gt; Checkout &gt; Customize.
              </s-text>
            </s-banner>

            <s-button
              icon="save"
              loading={fetcher.state !== "idle" || undefined}
              onClick={() =>
                fetcher.submit(
                  {
                    intent: "save_branding",
                    primaryColor,
                    accentColor,
                    buttonStyle,
                    showTrustBadges: String(showTrustBadges),
                    customMessage,
                  },
                  { method: "POST" },
                )
              }
            >
              Save display settings
            </s-button>
          </s-stack>
        </s-box>
      </s-section>

      {/* 3. Survey Questions */}
      <s-section heading="Post-Purchase Survey">
        <s-box padding="base" borderWidth="base" borderRadius="large">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-icon type="forms" color="subdued" size="small" />
              <s-text type="strong">Survey Questions</s-text>
              {surveyResponseCount > 0 && (
                <s-badge tone="success">{surveyResponseCount} responses</s-badge>
              )}
            </s-stack>
            <s-divider />

            {surveyQuestions.length === 0 ? (
              <s-text color="subdued">
                No questions yet. Add questions to collect customer feedback on
                the thank-you page.
              </s-text>
            ) : (
              surveyQuestions.map((q, idx) => (
                <s-stack
                  key={q.id}
                  direction="inline"
                  gap="base"
                  alignItems="center"
                >
                  <s-badge tone="info">{idx + 1}</s-badge>
                  <s-stack gap="small-100">
                    <s-text type="strong">{q.question}</s-text>
                    <s-text color="subdued">
                      Type: {q.questionType}
                      {q.questionType === "multiple_choice" &&
                        ` — ${JSON.parse(q.options).join(", ")}`}
                    </s-text>
                  </s-stack>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    icon="delete"
                    accessibilityLabel="Delete question"
                    onClick={() =>
                      fetcher.submit(
                        { intent: "delete_question", questionId: q.id },
                        { method: "POST" },
                      )
                    }
                  />
                </s-stack>
              ))
            )}

            <s-button
              variant="secondary"
              icon="plus"
              onClick={() => questionModalRef.current?.showOverlay()}
            >
              Add question
            </s-button>
          </s-stack>
        </s-box>
      </s-section>

      {/* Add Question Modal */}
      <s-modal accessibilityLabel="Widget settings"
        id="add-question-modal"
        ref={questionModalRef}
        heading="Add Survey Question"
      >
        <s-stack gap="base">
          <s-text-field
            label="Question"
            value={newQuestion}
            onChange={(e: any) => setNewQuestion(e.target.value)}
          />
          <s-select
            label="Question Type"
            value={newQuestionType}
            onChange={(e: any) => setNewQuestionType(e.target.value)}
          >
            <s-option value="rating">Star Rating (1-5)</s-option>
            <s-option value="text">Free Text</s-option>
            <s-option value="multiple_choice">Multiple Choice</s-option>
          </s-select>
          {newQuestionType === "multiple_choice" && (
            <s-text-field
              label="Options (comma-separated)"
              value={newOptions}
              onChange={(e: any) => setNewOptions(e.target.value)}
            />
          )}
        </s-stack>
        <s-button
          variant="primary" slot="primary-action"
          loading={fetcher.state !== "idle" || undefined}
          onClick={() =>
            fetcher.submit(
              {
                intent: "add_question",
                question: newQuestion,
                questionType: newQuestionType,
                options:
                  newQuestionType === "multiple_choice"
                    ? JSON.stringify(
                        newOptions
                          .split(",")
                          .map((o) => o.trim())
                          .filter(Boolean),
                      )
                    : "[]",
              },
              { method: "POST" },
            )
          }
        >
          Add question
        </s-button>
        <s-button
          slot="secondary-action"
          onClick={() => questionModalRef.current?.hideOverlay()}
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
