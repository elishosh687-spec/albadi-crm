"use client";

/**
 * Tabbed wrapper for the calculator widget — tab "מחשבון" renders the live
 * pricing calculator, tab "הגדרות" renders the same SettingsView used by the
 * /widget/settings standalone widget. Lets Eli edit FX / margin / shipping
 * without leaving the calculator screen.
 */

import { useState } from "react";
import { Calculator as CalcIcon, Settings as SettingsIcon } from "lucide-react";
import { CalculatorView } from "./CalculatorView";
import { SettingsView } from "@/components/settings/SettingsView";
import type { Product, QuantityTier, ShippingOption } from "@/lib/factory/calculator/types";

interface Props {
  products: Product[];
  quantityTiers: QuantityTier[];
  shippingOptions: ShippingOption[];
  initialMargins: Record<string, number>;
  apiToken: string;
}

type Tab = "calculator" | "settings";

export function CalculatorWithSettings(props: Props) {
  const [tab, setTab] = useState<Tab>("calculator");

  return (
    <div className="flex flex-col gap-4" dir="rtl">
      <div className="inline-flex self-start rounded-lg border border-border bg-card/40 p-1 gap-1">
        <TabButton active={tab === "calculator"} onClick={() => setTab("calculator")}>
          <CalcIcon className="size-3.5" />
          מחשבון
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
          <SettingsIcon className="size-3.5" />
          הגדרות
        </TabButton>
      </div>

      {tab === "calculator" ? (
        <CalculatorView {...props} />
      ) : (
        <SettingsView apiToken={props.apiToken} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
