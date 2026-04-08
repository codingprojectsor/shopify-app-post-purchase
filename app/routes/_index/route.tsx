import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.logo}>U</div>
        <h1 className={styles.heading}>
          Boost Revenue with{" "}
          <span className={styles.highlight}>Post-Purchase Upsells</span>
        </h1>
        <p className={styles.tagline}>
          UpsellHive shows targeted product offers on the thank-you page after checkout.
          Customers add items with one click — no re-entering payment details.
        </p>

        {/* Login form */}
        {showForm && (
          <div className={styles.formCard}>
            <Form method="post" action="/auth/login">
              <label className={styles.formLabel}>Shop domain</label>
              <input
                className={styles.formInput}
                type="text"
                name="shop"
                placeholder="my-store.myshopify.com"
              />
              <button className={styles.formButton} type="submit">
                Install App
              </button>
            </Form>
          </div>
        )}
      </div>

      {/* Features */}
      <div className={styles.features}>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>&#x1F3AF;</div>
          <h3 className={styles.featureTitle}>Smart Targeting</h3>
          <p className={styles.featureDesc}>
            Show the right offer to the right customer based on cart value, products, customer tags, shipping country, and more.
          </p>
        </div>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>&#x26A1;</div>
          <h3 className={styles.featureTitle}>One-Click Upsells</h3>
          <p className={styles.featureDesc}>
            Customers accept offers instantly on the thank-you page. No checkout friction — the item is added to their existing order.
          </p>
        </div>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>&#x1F4CA;</div>
          <h3 className={styles.featureTitle}>A/B Testing & Analytics</h3>
          <p className={styles.featureDesc}>
            Test different offers, track conversion rates, and export data. Know exactly which upsells drive the most revenue.
          </p>
        </div>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>&#x1F504;</div>
          <h3 className={styles.featureTitle}>Funnel Chaining</h3>
          <p className={styles.featureDesc}>
            When a customer declines an offer, automatically show a fallback. Maximize every opportunity with multi-step funnels.
          </p>
        </div>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>&#x1F3A8;</div>
          <h3 className={styles.featureTitle}>Custom Branding</h3>
          <p className={styles.featureDesc}>
            Match your store's look with custom colors, button styles, trust badges, and thank-you messages.
          </p>
        </div>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>&#x23F0;</div>
          <h3 className={styles.featureTitle}>Countdown Timers</h3>
          <p className={styles.featureDesc}>
            Create urgency with time-limited offers. Customers see a countdown that drives faster decisions.
          </p>
        </div>
      </div>

      {/* Links */}
      <div className={styles.links}>
        <a href="/admin-login" className={styles.link}>Admin Panel</a>
        <a href="/app" className={styles.link}>Open App</a>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        UpsellHive &mdash; Post-Purchase Upsell App for Shopify
      </div>
    </div>
  );
}
