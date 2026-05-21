/**
 * Shared row shape used by every component in components/factory-flow/*.
 * Mirrors `FactoryQuoteRow` from app/dashboard/v3/_components/factory/FactoryQuotePanel.tsx
 * — kept local so the widget bundle does not import dashboard server modules.
 */

import type {
  FactoryProductSpec,
  FactoryResponse,
  FactoryPricingResult,
  FactoryQuoteStatus,
} from "@/lib/factory/types";

export interface FactoryQuoteRow {
  id: string;
  manychatSubId: string;
  quotationNo: string | null;
  createdAt: string;
  updatedAt: string;
  productSpec: FactoryProductSpec;
  feishuRowIndex: string | null;
  factoryStatus: FactoryQuoteStatus;
  factoryResponse: FactoryResponse | null;
  finalPricing: FactoryPricingResult | null;
  pdfUrl: string | null;
  sentToCustomerAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
}
