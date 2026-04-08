import { useOutletContext } from "react-router";
import type { PlanLimits } from "../types/plan-limits";
import { FREE_PLAN_LIMITS } from "../types/plan-limits";

interface AppContext {
  currency: string;
  planLimits: PlanLimits;
  currentPlan: string;
  activeOfferCount: number;
}

export function usePlanLimits() {
  try {
    const ctx = useOutletContext<AppContext>();
    return {
      limits: ctx?.planLimits || FREE_PLAN_LIMITS,
      currentPlan: ctx?.currentPlan || "free",
      activeOfferCount: ctx?.activeOfferCount || 0,
      canCreateOffer: ctx?.planLimits
        ? ctx.planLimits.maxOffers === -1 || ctx.activeOfferCount < ctx.planLimits.maxOffers
        : true,
    };
  } catch {
    return {
      limits: FREE_PLAN_LIMITS,
      currentPlan: "free",
      activeOfferCount: 0,
      canCreateOffer: true,
    };
  }
}
