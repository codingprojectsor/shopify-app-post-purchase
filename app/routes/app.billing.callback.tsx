import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { syncSubscriptionStatus } from "../utils/billing.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  // Shopify redirects here after the merchant approves/declines the charge.
  // Sync the subscription state from Shopify to our DB.
  await syncSubscriptionStatus(admin, session.shop);

  // Redirect back to the pricing page
  return redirect("/app/pricing");
};
