import type { ActionFunctionArgs } from "react-router";
import { verifyExtensionToken } from "../utils/verify-extension-token.server";
import { handleCors, corsJson, corsError } from "../utils/cors.server";
import db from "../db.server";

export const loader = () => new Response(null, {
  status: 204,
  headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" },
});

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const preflight = handleCors(request);
    if (preflight) return preflight;

    let shop: string;
    try {
      const result = await verifyExtensionToken(request);
      shop = result.shop;
    } catch (err) {
      const status = err instanceof Response ? err.status : 500;
      const msg = err instanceof Response ? await err.text() : "Auth failed";
        return corsError(msg, status);
    }

    const body = await request.json();
    const { intent } = body;

    if (!intent || intent === "config") {
      const widgets = await db.widgetConfig.findMany({
        where: { shop, enabled: true },
        orderBy: { position: "asc" },
      });

      const branding = await db.brandingConfig.findFirst({
        where: { shop },
      });

      const survey = await db.surveyQuestion.findMany({
        where: { shop, enabled: true },
        orderBy: { position: "asc" },
      });

      return corsJson({
        widgets: widgets.map((w) => {
          let settings = {};
          try { settings = JSON.parse(w.settings); } catch { /* ignore */ }
          return { type: w.widgetType, position: w.position, settings };
        }),
        branding: branding
          ? {
              primaryColor: branding.primaryColor,
              accentColor: branding.accentColor,
              buttonStyle: branding.buttonStyle,
              showTrustBadges: branding.showTrustBadges,
              customMessage: branding.customMessage,
            }
          : null,
        survey: survey.map((q) => {
          let options: string[] = [];
          try { options = JSON.parse(q.options); } catch { /* ignore */ }
          return { id: q.id, question: q.question, type: q.questionType, options };
        }),
      });
    }

    if (intent === "survey_response") {
      const { questionId, answer, orderId } = body;
      if (!questionId || !answer) return corsError("Missing data", 400);

      await db.surveyResponse.create({
        data: { shop, questionId, answer, orderId },
      });
      await db.analyticsEvent.create({
        data: { shop, eventType: "survey_response", metadata: JSON.stringify({ questionId, answer }) },
      });
      return corsJson({ success: true });
    }

    if (intent === "social_share") {
      const { platform } = body;
      await db.analyticsEvent.create({
        data: { shop, eventType: "social_share", metadata: JSON.stringify({ platform }) },
      });
      return corsJson({ success: true });
    }

    return corsError("Unknown intent", 400);
  } catch (err) {
    return corsError(String(err), 500);
  }
};
