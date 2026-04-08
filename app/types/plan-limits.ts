export interface PlanLimits {
  maxOffers: number; // -1 = unlimited
  abTesting: boolean;
  analytics: boolean;
  customBranding: boolean;
  prioritySupport: boolean;
  scheduledOffers: boolean;
  funnelChaining: boolean;
  csvExport: boolean;
}

export const FREE_PLAN_LIMITS: PlanLimits = {
  maxOffers: 2,
  abTesting: false,
  analytics: false,
  customBranding: false,
  prioritySupport: false,
  scheduledOffers: false,
  funnelChaining: false,
  csvExport: false,
};
