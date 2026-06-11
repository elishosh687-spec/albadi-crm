"use client";

import React from "react";
import { Building2, Loader2, Mail, Package2, Phone, ReceiptText, User } from "lucide-react";
import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";
import {
  formatCurrency,
  type CustomerInfo,
  type PricingInfo,
  type QuoteSpec,
} from "./configurator-state";

interface PricingContractFormProps {
  bagColor: string;
  hasLogo: boolean;
  customerInfo: CustomerInfo;
  pricingInfo: PricingInfo;
  quoteSpec: QuoteSpec;
  products: Array<{ id: string; dimensions: string; description: string }>;
  shippingOptions: Array<{ id: string; name: string; description: string }>;
  onCustomerInfoChange: (info: CustomerInfo) => void;
  onQuoteSpecChange: (spec: QuoteSpec) => void;
}

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${colors.rule}`,
  borderRadius: radius.md,
  padding: `${space.sm}px ${space.md}px`,
  background: colors.surface,
  color: colors.ink,
  fontFamily: fontStack.body,
  fontSize: size.md,
};

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: space.xs }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: space.xs,
          color: colors.ink,
          fontSize: size.sm,
          fontWeight: weight.medium,
        }}
      >
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

export const PricingContractForm: React.FC<PricingContractFormProps> = ({
  bagColor,
  hasLogo,
  customerInfo,
  pricingInfo,
  quoteSpec,
  products,
  shippingOptions,
  onCustomerInfoChange,
  onQuoteSpecChange,
}) => {
  const handleCustomerChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const nextCustomerInfo = {
      ...customerInfo,
      [name]: name === "quantity" ? Math.max(1, Number(value) || 0) : value,
    };
    onCustomerInfoChange(nextCustomerInfo);

    if (name === "quantity") {
      onQuoteSpecChange({
        ...quoteSpec,
        quantity: nextCustomerInfo.quantity,
      });
    }
  };

  const patchSpec = (patch: Partial<QuoteSpec>) => {
    onQuoteSpecChange({ ...quoteSpec, ...patch });
  };

  const selectedProduct = products.find((p) => p.id === quoteSpec.productId);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="שם מלא *" icon={<User className="size-4" />}>
            <input
              type="text"
              name="name"
              value={customerInfo.name}
              onChange={handleCustomerChange}
              placeholder="יוסי כהן"
              style={INPUT_STYLE}
            />
          </Field>

          <Field label="שם חברה" icon={<Building2 className="size-4" />}>
            <input
              type="text"
              name="company"
              value={customerInfo.company}
              onChange={handleCustomerChange}
              placeholder="שם החברה"
              style={INPUT_STYLE}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label='דוא"ל *' icon={<Mail className="size-4" />}>
            <input
              type="email"
              name="email"
              value={customerInfo.email}
              onChange={handleCustomerChange}
              placeholder="name@company.com"
              style={INPUT_STYLE}
            />
          </Field>

          <Field label="טלפון *" icon={<Phone className="size-4" />}>
            <input
              type="tel"
              name="phone"
              value={customerInfo.phone}
              onChange={handleCustomerChange}
              placeholder="050-1234567"
              style={INPUT_STYLE}
            />
          </Field>
        </div>

        <Field label="הערות מיוחדות">
          <textarea
            name="notes"
            value={customerInfo.notes}
            onChange={handleCustomerChange}
            placeholder="מיקום הדפסה, מועד אספקה, דרישות נוספות..."
            rows={4}
            style={{ ...INPUT_STYLE, resize: "vertical" }}
          />
        </Field>
      </div>

      <div
        style={{
          border: `1px solid ${colors.rule}`,
          borderRadius: radius.lg,
          background: colors.surfaceMuted,
          padding: space.lg,
          display: "flex",
          flexDirection: "column",
          gap: space.lg,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: space.sm,
            color: colors.ink,
            fontWeight: weight.medium,
          }}
        >
          <ReceiptText className="size-4" />
          תמחור (מנוע המחירון)
        </div>

        <Field label="גודל שקית">
          <select
            value={quoteSpec.productId}
            onChange={(e) => patchSpec({ productId: e.target.value })}
            style={INPUT_STYLE}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.dimensions} — {p.description}
              </option>
            ))}
          </select>
        </Field>

        <Field label="כמות" icon={<Package2 className="size-4" />}>
          <input
            type="number"
            name="quantity"
            value={customerInfo.quantity}
            onChange={handleCustomerChange}
            min="1000"
            step="500"
            style={INPUT_STYLE}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="משלוח">
            <select
              value={quoteSpec.shippingOptionId}
              onChange={(e) => patchSpec({ shippingOptionId: e.target.value })}
              style={INPUT_STYLE}
            >
              {shippingOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.description}
                </option>
              ))}
            </select>
          </Field>

          <Field label="צבעי לוגו">
            <select
              value={quoteSpec.logoColors}
              onChange={(e) => patchSpec({ logoColors: Number(e.target.value) })}
              style={INPUT_STYLE}
            >
              <option value={1}>צבע אחד</option>
              <option value={2}>2 צבעים</option>
              <option value={3}>3 צבעים</option>
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={quoteSpec.hasHandles}
              onChange={(e) => patchSpec({ hasHandles: e.target.checked })}
            />
            ידיות
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={quoteSpec.hasLamination}
              onChange={(e) => patchSpec({ hasLamination: e.target.checked })}
            />
            למינציה
          </label>
        </div>

        <div
          style={{
            borderRadius: radius.lg,
            background: colors.surface,
            border: `1px solid ${colors.rule}`,
            padding: space.lg,
          }}
        >
          {pricingInfo.loading ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: colors.inkMuted }}>
              <Loader2 className="size-4 animate-spin" />
              מחשב מחיר...
            </div>
          ) : pricingInfo.error ? (
            <p style={{ margin: 0, fontSize: size.sm, color: colors.danger }}>
              {pricingInfo.error}
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gap: space.sm,
                fontSize: size.sm,
                color: colors.inkMuted,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span>מידות</span>
                <strong style={{ color: colors.ink }}>
                  {selectedProduct?.dimensions ?? pricingInfo.productDimensions}
                </strong>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>צבע בד</span>
                <strong style={{ color: colors.ink }}>{bagColor}</strong>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>לוגו</span>
                <strong style={{ color: hasLogo ? colors.success : colors.warning }}>
                  {hasLogo ? "הועלה" : "לא הועלה"}
                </strong>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>משלוח</span>
                <strong style={{ color: colors.ink }}>{pricingInfo.shippingOptionName}</strong>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>מחיר ליחידה</span>
                <strong style={{ color: colors.ink }}>
                  {formatCurrency(pricingInfo.unitPriceIls)}
                </strong>
              </div>
              {pricingInfo.altShipping ? (
                <div className="flex items-center justify-between gap-3">
                  <span>חלופה ({pricingInfo.altShipping.shippingOptionName})</span>
                  <strong style={{ color: colors.inkMuted }}>
                    {formatCurrency(pricingInfo.altShipping.unitPriceIls)}/יח׳
                  </strong>
                </div>
              ) : null}
              <div
                className="flex items-center justify-between gap-3"
                style={{
                  paddingTop: space.sm,
                  borderTop: `1px solid ${colors.rule}`,
                  fontSize: size.md,
                }}
              >
                <span style={{ color: colors.ink, fontWeight: weight.medium }}>
                  סה״כ הזמנה ({pricingInfo.quantity} יח׳)
                </span>
                <strong style={{ color: colors.accent }}>
                  {formatCurrency(pricingInfo.totalOrderIls)}
                </strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PricingContractForm;
