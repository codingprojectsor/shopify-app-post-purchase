export interface OfferSummary {
  id: string;
  title: string;
  productTitle: string;
  productImage: string | null;
  productPrice: string;
  discountType: string;
  discountValue: number;
  enabled: boolean;
  testMode: boolean;
  priority: number;
  views: number;
  accepts: number;
  declines: number;
  revenue: number;
  conversionRate: number;
  createdAt: string;
}

export interface DashboardStats {
  totalOffers: number;
  activeOffers: number;
  totalViews: number;
  totalAccepts: number;
  totalDeclines: number;
  totalRevenue: number;
  overallConversion: number;
}
