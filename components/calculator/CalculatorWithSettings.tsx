"use client";

/**
 * Thin wrapper around the calculator widget. Settings (FX / margin / shipping /
 * sea carriers) live ONLY in the dedicated "⚙️ הגדרות" hub tab — they are NOT
 * duplicated here. This wrapper just renders the calculator and keeps its
 * per-quantity margins fresh: it re-pulls the live config on mount so a margin
 * edited in the settings tab takes effect when the calculator is reopened,
 * without a manual page refresh.
 */

import { useState, useEffect } from "react";
import { CalculatorView, type EstimatePrefill } from "./CalculatorView";
import type { Product, QuantityTier, ShippingOption } from "@/lib/factory/calculator/types";

interface Props {
  products: Product[];
  quantityTiers: QuantityTier[];
  shippingOptions: ShippingOption[];
  initialMargins: Record<string, number>;
  apiToken: string;
  sid?: string;
  leadName?: string | null;
  initialTab?: "operator" | "estimate";
  estimatePrefill?: EstimatePrefill;
}

export function CalculatorWithSettings(props: Props) {
  const [margins, setMargins] = useState<Record<string, number>>(props.initialMargins);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/widget/factory/config?widget_token=${encodeURIComponent(props.apiToken)}`,
      { cache: "no-store" }
    )
      .then((r) => r.json())
      .then((data) => {
        const m = data?.config?.profitMarginByQuantity;
        if (!cancelled && m && typeof m === "object") {
          setMargins(m as Record<string, number>);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.apiToken]);

  return (
    <CalculatorView
      products={props.products}
      quantityTiers={props.quantityTiers}
      shippingOptions={props.shippingOptions}
      initialMargins={margins}
      apiToken={props.apiToken}
      sid={props.sid}
      leadName={props.leadName}
      initialTab={props.initialTab}
      estimatePrefill={props.estimatePrefill}
    />
  );
}
