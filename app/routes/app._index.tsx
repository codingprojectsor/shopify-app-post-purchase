import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type {
  ActionFunctionArgs,
  HeadersArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect } from "react";

interface OfferSummary {
  id: string;
  title: string;
  productTitle: string;
  productImage: string | null;
  discountType: string;
  discountValue: number;
  enabled: boolean;
  testMode: boolean;
  priority: number;
  totalEvents: number;
  totalAccepts: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const offers = await db.upsellOffer.findMany({
    where: { shop: session.shop },
    orderBy: { priority: "desc" },
    include: {
      _count: {
        select: {
          analyticsEvents: true,
        },
      },
      analyticsEvents: {
        where: { eventType: "accept" },
        select: { id: true },
      },
    },
  });

  const offersWithStats: OfferSummary[] = offers.map((offer) => ({
    id: offer.id,
    title: offer.title,
    productTitle: offer.productTitle,
    productImage: offer.productImage,
    discountType: offer.discountType,
    discountValue: offer.discountValue,
    enabled: offer.enabled,
    testMode: offer.testMode,
    priority: offer.priority,
    totalEvents: offer._count.analyticsEvents,
    totalAccepts: offer.analyticsEvents.length,
  }));

  return { offers: offersWithStats };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle") {
    const offerId = formData.get("offerId") as string;
    const enabled = formData.get("enabled") === "true";

    await db.upsellOffer.updateMany({
      where: { id: offerId, shop: session.shop },
      data: { enabled },
    });

    return { success: true };
  }

  if (intent === "delete") {
    const offerId = formData.get("offerId") as string;

    await db.upsellOffer.deleteMany({
      where: { id: offerId, shop: session.shop },
    });

    return { success: true, deleted: true };
  }

  return { success: false };
};

export default function OffersIndex() {
  const { offers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      typeof fetcher.data === "object" &&
      "deleted" in fetcher.data
    ) {
      shopify.toast.show("Offer deleted");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  if (offers.length === 0) {
    return (
      <s-page heading="Upsell Offers">
        <s-button
          slot="primary-action"
          onClick={() => navigate("/app/offers/new")}
        >
          Create offer
        </s-button>
        <s-section>
          <s-stack gap="large">
            <s-text type="strong">No upsell offers yet</s-text>
            <s-paragraph>
              Create your first upsell offer to start showing post-purchase
              offers on the thank-you page.
            </s-paragraph>
            <s-button onClick={() => navigate("/app/offers/new")}>
              Create your first offer
            </s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Upsell Offers">
      <s-button
        slot="primary-action"
        onClick={() => navigate("/app/offers/new")}
      >
        Create offer
      </s-button>

      <s-section>
        <s-stack gap="base">
          {offers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              fetcher={fetcher}
              onEdit={() => navigate(`/app/offers/${offer.id}`)}
            />
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function OfferCard({
  offer,
  fetcher,
  onEdit,
}: {
  offer: OfferSummary;
  fetcher: ReturnType<typeof useFetcher>;
  onEdit: () => void;
}) {
  const discountLabel =
    offer.discountType === "percentage"
      ? `${offer.discountValue}% off`
      : `$${offer.discountValue} off`;

  const handleToggle = () => {
    fetcher.submit(
      {
        intent: "toggle",
        offerId: offer.id,
        enabled: String(!offer.enabled),
      },
      { method: "POST" },
    );
  };

  const handleDelete = () => {
    fetcher.submit(
      { intent: "delete", offerId: offer.id },
      { method: "POST" },
    );
  };

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="base">
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="base">
            <s-text type="strong">{offer.title}</s-text>
            {offer.testMode && <s-badge tone="info">Test</s-badge>}
            <s-badge tone={offer.enabled ? "success" : undefined}>
              {offer.enabled ? "Active" : "Disabled"}
            </s-badge>
          </s-stack>
          <s-text color="subdued">
            {offer.productTitle} · {discountLabel} · Priority: {offer.priority}
          </s-text>
          <s-text color="subdued">
            {offer.totalAccepts} accepts / {offer.totalEvents} total events
          </s-text>
        </s-stack>
        <s-stack direction="inline" gap="small-200">
          <s-button onClick={handleToggle} variant="tertiary">
            {offer.enabled ? "Disable" : "Enable"}
          </s-button>
          <s-button onClick={onEdit} variant="tertiary">
            Edit
          </s-button>
          <s-button onClick={handleDelete} variant="tertiary" tone="critical">
            Delete
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export const headers = (headersArgs: HeadersArgs) => {
  return boundary.headers(headersArgs);
};
