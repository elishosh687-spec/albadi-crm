"use client";

import { useEffect, useRef, useState } from "react";
import { getConfiguratorApiBase } from "@/lib/configurator/urls";
import {
  DEFAULT_PRICING_INFO,
  normalizePricing,
  type PricingInfo,
  type QuoteSpec,
} from "./configurator-state";

interface QuoteApiResponse {
  ok: boolean;
  productId: string;
  productDimensions: string;
  productDescription: string;
  quantity: number;
  hasHandles: boolean;
  logoColors: number;
  hasLamination: boolean;
  shippingOptionId: string;
  shippingOptionName: string;
  unitPriceIls: number;
  totalOrderIls: number;
  profitMargin: number;
  altShipping: PricingInfo["altShipping"];
  error?: string;
}

export function useConfiguratorQuote(spec: QuoteSpec) {
  const [pricing, setPricing] = useState<PricingInfo>(DEFAULT_PRICING_INFO);
  const requestId = useRef(0);

  useEffect(() => {
    const current = ++requestId.current;
    const controller = new AbortController();

    setPricing((prev) => ({
      ...prev,
      ...spec,
      loading: true,
      error: null,
    }));

    const params = new URLSearchParams({
      productId: spec.productId,
      quantity: String(spec.quantity),
      hasHandles: String(spec.hasHandles),
      logoColors: String(spec.logoColors),
      hasLamination: String(spec.hasLamination),
      shippingOptionId: spec.shippingOptionId,
    });

    const apiBase = getConfiguratorApiBase();
    void fetch(`${apiBase}/api/configurator/quote?${params}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as QuoteApiResponse;
        if (current !== requestId.current) return;
        if (!res.ok || !data.ok) {
          setPricing((prev) => ({
            ...prev,
            loading: false,
            error: data.error ?? "שגיאה בחישוב מחיר",
          }));
          return;
        }

        setPricing(
          normalizePricing({
            quantity: data.quantity,
            unitPriceIls: data.unitPriceIls,
            totalOrderIls: data.totalOrderIls,
            productId: data.productId,
            productDimensions: data.productDimensions,
            productDescription: data.productDescription,
            shippingOptionId: data.shippingOptionId,
            shippingOptionName: data.shippingOptionName,
            hasHandles: data.hasHandles,
            logoColors: data.logoColors,
            hasLamination: data.hasLamination,
            profitMargin: data.profitMargin,
            altShipping: data.altShipping,
            loading: false,
            error: null,
          })
        );
      })
      .catch((err: unknown) => {
        if (current !== requestId.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPricing((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : "שגיאת רשת",
        }));
      });

    return () => controller.abort();
  }, [
    spec.productId,
    spec.quantity,
    spec.hasHandles,
    spec.logoColors,
    spec.hasLamination,
    spec.shippingOptionId,
  ]);

  return pricing;
}
