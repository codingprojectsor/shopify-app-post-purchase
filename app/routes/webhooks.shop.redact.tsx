import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Shop has been uninstalled for 48+ hours — delete ALL shop data.
  await db.surveyResponse.deleteMany({ where: { shop } });
  await db.surveyQuestion.deleteMany({ where: { shop } });
  await db.analyticsEvent.deleteMany({ where: { shop } });
  await db.targetingRule.deleteMany({
    where: { offer: { shop } },
  });
  await db.upsellOffer.deleteMany({ where: { shop } });
  await db.aBTest.deleteMany({ where: { shop } });
  await db.widgetConfig.deleteMany({ where: { shop } });
  await db.brandingConfig.deleteMany({ where: { shop } });
  await db.session.deleteMany({ where: { shop } });

  console.log(`All data redacted for shop ${shop}`);

  return new Response();
};
