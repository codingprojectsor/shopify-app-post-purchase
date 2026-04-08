import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
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

interface ABTestSummary {
  id: string;
  name: string;
  description: string;
  status: string;
  splitPercent: number;
  winnerId: string | null;
  createdAt: string;
  offers: {
    id: string;
    title: string;
    productTitle: string;
    views: number;
    accepts: number;
    revenue: number;
    conversionRate: number;
  }[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const tests = await db.aBTest.findMany({
    where: { shop: session.shop },
    include: {
      offers: {
        include: {
          analyticsEvents: {
            select: { eventType: true, revenue: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const abTests: ABTestSummary[] = tests.map((test) => ({
    id: test.id,
    name: test.name,
    description: test.description,
    status: test.status,
    splitPercent: test.splitPercent,
    winnerId: test.winnerId,
    createdAt: test.createdAt.toISOString().slice(0, 10),
    offers: test.offers.map((offer) => {
      const views = offer.analyticsEvents.filter(
        (e) => e.eventType === "view",
      ).length;
      const accepts = offer.analyticsEvents.filter(
        (e) => e.eventType === "accept",
      ).length;
      const revenue = offer.analyticsEvents
        .filter((e) => e.eventType === "accept" && e.revenue)
        .reduce((sum, e) => sum + (e.revenue || 0), 0);
      return {
        id: offer.id,
        title: offer.title,
        productTitle: offer.productTitle,
        views,
        accepts,
        revenue,
        conversionRate: views > 0 ? Math.round((accepts / views) * 100) : 0,
      };
    }),
  }));

  // Available offers (not in any test) for creating new tests
  const availableOffers = await db.upsellOffer.findMany({
    where: { shop: session.shop, abTestId: null },
    select: { id: true, title: true, productTitle: true },
    orderBy: { title: "asc" },
  });

  return { abTests, availableOffers };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const splitPercent = parseInt(formData.get("splitPercent") as string) || 50;
    const offerAId = formData.get("offerAId") as string;
    const offerBId = formData.get("offerBId") as string;

    if (!name || !offerAId || !offerBId) {
      return { error: "Name and two offers are required" };
    }

    if (offerAId === offerBId) {
      return { error: "Please select two different offers" };
    }

    const test = await db.aBTest.create({
      data: {
        shop: session.shop,
        name,
        description: description || "",
        splitPercent,
      },
    });

    // Link offers to the test
    await db.upsellOffer.updateMany({
      where: { id: { in: [offerAId, offerBId] }, shop: session.shop },
      data: { abTestId: test.id },
    });

    return { success: true, created: true };
  }

  if (intent === "start") {
    const testId = formData.get("testId") as string;
    await db.aBTest.updateMany({
      where: { id: testId, shop: session.shop },
      data: { status: "running", startedAt: new Date() },
    });
    return { success: true };
  }

  if (intent === "stop") {
    const testId = formData.get("testId") as string;
    await db.aBTest.updateMany({
      where: { id: testId, shop: session.shop },
      data: { status: "completed", endedAt: new Date() },
    });
    return { success: true };
  }

  if (intent === "pick_winner") {
    const testId = formData.get("testId") as string;
    const winnerId = formData.get("winnerId") as string;
    await db.aBTest.updateMany({
      where: { id: testId, shop: session.shop },
      data: { winnerId, status: "completed", endedAt: new Date() },
    });
    return { success: true };
  }

  if (intent === "delete") {
    const testId = formData.get("testId") as string;
    // Unlink offers
    await db.upsellOffer.updateMany({
      where: { abTestId: testId, shop: session.shop },
      data: { abTestId: null },
    });
    await db.aBTest.deleteMany({
      where: { id: testId, shop: session.shop },
    });
    return { success: true, deleted: true };
  }

  return { success: false };
};

export default function ABTests() {
  const { abTests, availableOffers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const { limits, currentPlan } = usePlanLimits();

  if (!limits.abTesting) {
    return (
      <s-page heading="A/B Tests">
        <s-section>
          <UpgradeBanner feature="A/B Testing" currentPlan={currentPlan} />
        </s-section>
      </s-page>
    );
  }
  const createModalRef = useRef<any>(null);
  const deleteModalRef = useRef<any>(null);
  const [deleteTestId, setDeleteTestId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [splitPercent, setSplitPercent] = useState("50");
  const [offerAId, setOfferAId] = useState("");
  const [offerBId, setOfferBId] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && typeof fetcher.data === "object") {
      if ("created" in fetcher.data) {
        shopify.toast.show("A/B test created");
        createModalRef.current?.hideOverlay();
        setName("");
        setDescription("");
        setOfferAId("");
        setOfferBId("");
      }
      if ("deleted" in fetcher.data) shopify.toast.show("Test deleted");
      if ("error" in fetcher.data) shopify.toast.show(fetcher.data.error as string);
    }
  }, [fetcher.state, fetcher.data, shopify]);

  return (
    <s-page heading="A/B Testing">
      {/* Breadcrumb */}
      <s-box paddingBlockEnd="base">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-link href="/app">
            <s-icon type="arrow-left" size="small" />
          </s-link>
          <s-link href="/app">Offers</s-link>
          <s-text color="subdued">/</s-text>
          <s-text color="subdued">A/B Testing</s-text>
        </s-stack>
      </s-box>

      <s-button
        variant="primary" slot="primary-action"
        icon="plus"
        onClick={() => createModalRef.current?.showOverlay()}
        disabled={availableOffers.length < 2 || undefined}
      >
        New test
      </s-button>

      {abTests.length === 0 ? (
        <s-section>
          <s-box padding="large-200" borderWidth="base" borderRadius="large">
            <s-stack gap="large" alignItems="center">
              <s-box padding="base" borderRadius="large" background="subdued">
                <s-icon type="chart-cohort" />
              </s-box>
              <s-stack gap="base" alignItems="center">
                <s-text type="strong">Split test your offers</s-text>
                <s-paragraph color="subdued">
                  Compare two offers head-to-head and find which one converts
                  better. You need at least 2 offers not already in a test.
                </s-paragraph>
              </s-stack>
              <s-stack direction="inline" gap="large">
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-icon type="chart-histogram-growth" color="subdued" size="small" />
                  <s-text color="subdued">Data-driven decisions</s-text>
                </s-stack>
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-icon type="arrows-out-horizontal" color="subdued" size="small" />
                  <s-text color="subdued">Custom traffic split</s-text>
                </s-stack>
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-icon type="star" color="subdued" size="small" />
                  <s-text color="subdued">Pick a winner</s-text>
                </s-stack>
              </s-stack>
              {availableOffers.length >= 2 && (
                <s-button onClick={() => createModalRef.current?.showOverlay()}>
                  Create your first test
                </s-button>
              )}
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        <s-section>
          <s-stack gap="base">
            {abTests.map((test) => (
              <ABTestCard
                key={test.id}
                test={test}
                onDelete={() => {
                  setDeleteTestId(test.id);
                  deleteModalRef.current?.showOverlay();
                }}
              />
            ))}
          </s-stack>
        </s-section>
      )}

      {/* Create Test Modal */}
      <s-modal accessibilityLabel="Dialog"
        id="create-ab-test"
        ref={createModalRef}
        heading="Create A/B Test"
      >
        <s-stack gap="base">
          <s-text-field
            label="Test name"
            value={name}
            onChange={(e: any) => setName(e.target.value)}
          />
          <s-text-field
            label="Description (optional)"
            value={description}
            onChange={(e: any) => setDescription(e.target.value)}
          />
          <s-text-field
            label="Traffic split (% to Variant A)"
            value={splitPercent}
            onChange={(e: any) => setSplitPercent(e.target.value)}
          />

          <s-select
            label="Variant A"
            value={offerAId}
            onChange={(e: any) => setOfferAId(e.target.value)}
          >
            <s-option value="">Select offer...</s-option>
            {availableOffers.map((o) => (
              <s-option key={o.id} value={o.id}>
                {o.title} — {o.productTitle}
              </s-option>
            ))}
          </s-select>

          <s-select
            label="Variant B"
            value={offerBId}
            onChange={(e: any) => setOfferBId(e.target.value)}
          >
            <s-option value="">Select offer...</s-option>
            {availableOffers
              .filter((o) => o.id !== offerAId)
              .map((o) => (
                <s-option key={o.id} value={o.id}>
                  {o.title} — {o.productTitle}
                </s-option>
              ))}
          </s-select>
        </s-stack>

        <s-button
          variant="primary" slot="primary-action"
          loading={fetcher.state !== "idle" || undefined}
          onClick={() => {
            fetcher.submit(
              {
                intent: "create",
                name,
                description,
                splitPercent,
                offerAId,
                offerBId,
              },
              { method: "POST" },
            );
          }}
        >
          Create test
        </s-button>
        <s-button
          slot="secondary-action"
          onClick={() => createModalRef.current?.hideOverlay()}
        >
          Cancel
        </s-button>
      </s-modal>

      {/* Delete Confirmation Modal */}
      <s-modal accessibilityLabel="Dialog"
        id="delete-ab-test"
        ref={deleteModalRef}
        heading="Delete this test?"
        onHide={() => setDeleteTestId(null)}
      >
        <s-text>
          This will remove the test and unlink its offers. The offers
          themselves will not be deleted.
        </s-text>
        <s-button
          variant="primary" slot="primary-action"
          tone="critical"
          onClick={() => {
            if (deleteTestId) {
              fetcher.submit(
                { intent: "delete", testId: deleteTestId },
                { method: "POST" },
              );
              deleteModalRef.current?.hideOverlay();
            }
          }}
        >
          Delete test
        </s-button>
        <s-button
          slot="secondary-action"
          onClick={() => deleteModalRef.current?.hideOverlay()}
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

function ABTestCard({
  test,
  onDelete,
}: {
  test: ABTestSummary;
  onDelete: () => void;
}) {
  const fetcher = useFetcher();
  const statusTone =
    test.status === "running"
      ? "warning"
      : test.status === "completed"
        ? "success"
        : "info";

  return (
    <s-box padding="base" borderWidth="base" borderRadius="large">
      <s-stack gap="base">
        {/* Header */}
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-text type="strong">{test.name}</s-text>
          <s-badge tone={statusTone}>{test.status}</s-badge>
          <s-text color="subdued">
            {test.splitPercent}% / {100 - test.splitPercent}% split
          </s-text>
        </s-stack>

        {test.description && (
          <s-text color="subdued">{test.description}</s-text>
        )}

        {/* Variant comparison table */}
        {test.offers.length > 0 && (
          <s-table>
            <s-table-header-row>
              <s-table-header>Variant</s-table-header>
              <s-table-header>Offer</s-table-header>
              <s-table-header>Views</s-table-header>
              <s-table-header>Accepts</s-table-header>
              <s-table-header>Conv.</s-table-header>
              <s-table-header>Revenue</s-table-header>
              <s-table-header>Result</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {test.offers.map((offer, i) => (
                <s-table-row key={offer.id}>
                  <s-table-cell>
                    <s-badge tone={i === 0 ? "info" : "neutral"}>
                      {i === 0 ? "A" : "B"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-100">
                      <s-text type="strong">{offer.title}</s-text>
                      <s-text color="subdued">{offer.productTitle}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text fontVariantNumeric="tabular-nums">
                      {offer.views}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text fontVariantNumeric="tabular-nums">
                      {offer.accepts}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text type="strong" fontVariantNumeric="tabular-nums">
                      {offer.conversionRate}%
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text fontVariantNumeric="tabular-nums">
                      ${offer.revenue.toFixed(2)}
                    </s-text>
                  </s-table-cell>
                  <s-table-cell>
                    {test.winnerId === offer.id && (
                      <s-badge tone="success" icon="check-circle">
                        Winner
                      </s-badge>
                    )}
                    {test.status === "running" && (
                      <s-button
                        variant="tertiary"
                        onClick={() =>
                          fetcher.submit(
                            {
                              intent: "pick_winner",
                              testId: test.id,
                              winnerId: offer.id,
                            },
                            { method: "POST" },
                          )
                        }
                      >
                        Pick winner
                      </s-button>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}

        {/* Statistical significance */}
        {test.offers.length === 2 && test.status === "running" && (
          <SignificanceResult offerA={test.offers[0]} offerB={test.offers[1]} />
        )}

        {/* Actions */}
        <s-stack direction="inline" gap="small-200">
          {test.status === "draft" && (
            <s-button
              onClick={() =>
                fetcher.submit(
                  { intent: "start", testId: test.id },
                  { method: "POST" },
                )
              }
              icon="play"
            >
              Start test
            </s-button>
          )}
          {test.status === "running" && (
            <s-button
              onClick={() =>
                fetcher.submit(
                  { intent: "stop", testId: test.id },
                  { method: "POST" },
                )
              }
              variant="secondary"
              icon="stop-circle"
            >
              Stop test
            </s-button>
          )}
          <s-button
            variant="tertiary"
            tone="critical"
            icon="delete"
            onClick={onDelete}
          >
            Delete
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function SignificanceResult({
  offerA,
  offerB,
}: {
  offerA: { views: number; accepts: number; conversionRate: number; title: string };
  offerB: { views: number; accepts: number; conversionRate: number; title: string };
}) {
  const totalSamples = offerA.views + offerB.views;

  if (totalSamples < 100) {
    return (
      <s-banner tone="info">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon type="info" size="small" />
          <s-text>
            Need at least 100 total views for significance. Currently at {totalSamples}.
          </s-text>
        </s-stack>
      </s-banner>
    );
  }

  // Z-test for two proportions
  const pA = offerA.views > 0 ? offerA.accepts / offerA.views : 0;
  const pB = offerB.views > 0 ? offerB.accepts / offerB.views : 0;
  const pPool =
    (offerA.accepts + offerB.accepts) / (offerA.views + offerB.views);
  const se = Math.sqrt(
    pPool * (1 - pPool) * (1 / offerA.views + 1 / offerB.views),
  );
  const z = se > 0 ? Math.abs(pA - pB) / se : 0;

  // Approximate confidence from z-score
  let confidence = 0;
  if (z >= 2.576) confidence = 99;
  else if (z >= 1.96) confidence = 95;
  else if (z >= 1.645) confidence = 90;
  else if (z >= 1.28) confidence = 80;
  else confidence = Math.round(z * 40);

  const significant = confidence >= 95;
  const leader = pA > pB ? offerA.title : offerB.title;
  const diff = Math.abs(offerA.conversionRate - offerB.conversionRate);

  return (
    <s-banner tone={significant ? "success" : "warning"}>
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-icon
            type={significant ? "check-circle" : "clock"}
            size="small"
          />
          <s-text type="strong">
            {significant
              ? `Statistically significant! ${confidence}% confidence`
              : `Not yet significant (${confidence}% confidence)`}
          </s-text>
        </s-stack>
        <s-text>
          {significant
            ? `"${leader}" is the winner with ${diff}pp higher conversion.`
            : `Keep running — need more data to determine a winner. Current difference: ${diff}pp.`}
        </s-text>
      </s-stack>
    </s-banner>
  );
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
