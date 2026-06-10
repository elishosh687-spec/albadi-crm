"use client";

import React from "react";
import { Building2, Mail, Package2, Phone, ReceiptText, User } from "lucide-react";
import { colors, fontStack, radius, size, space, weight } from "@/lib/ui/tokens";
import {
  calculateTotalPrice,
  formatCurrency,
  type CustomerInfo,
  type PricingInfo,
} from "./configurator-state";

interface PricingContractFormProps {
  bagColor: string;
  hasLogo: boolean;
  customerInfo: CustomerInfo;
  pricingInfo: PricingInfo;
  onCustomerInfoChange: (info: CustomerInfo) => void;
  onPricingChange: (pricing: PricingInfo) => void;
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
  onCustomerInfoChange,
  onPricingChange,
}) => {
  const handleCustomerChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const nextCustomerInfo = {
      ...customerInfo,
      [name]: name === "quantity" ? Math.max(0, Number(value) || 0) : value,
    };
    onCustomerInfoChange(nextCustomerInfo);

    if (name === "quantity") {
      onPricingChange({
        ...pricingInfo,
        quantity: nextCustomerInfo.quantity,
        totalPrice: calculateTotalPrice(
          nextCustomerInfo.quantity,
          pricingInfo.unitPrice,
          pricingInfo.setupFee
        ),
      });
    }
  };

  const handlePricingInputChange = (field: "unitPrice" | "setupFee", value: string) => {
    const nextValue = Math.max(0, Number(value) || 0);
    const nextPricing = {
      ...pricingInfo,
      [field]: nextValue,
      totalPrice: calculateTotalPrice(
        pricingInfo.quantity,
        field === "unitPrice" ? nextValue : pricingInfo.unitPrice,
        field === "setupFee" ? nextValue : pricingInfo.setupFee
      ),
    };

    onPricingChange(nextPricing);
  };

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
          תמחור
        </div>

        <Field label="כמות" icon={<Package2 className="size-4" />}>
          <input
            type="number"
            name="quantity"
            value={customerInfo.quantity}
            onChange={handleCustomerChange}
            min="1"
            style={INPUT_STYLE}
          />
        </Field>

        <Field label="מחיר ליחידה (USD)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={pricingInfo.unitPrice}
            onChange={(event) => handlePricingInputChange("unitPrice", event.target.value)}
            style={INPUT_STYLE}
          />
        </Field>

        <Field label="Setup fee (USD)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={pricingInfo.setupFee}
            onChange={(event) => handlePricingInputChange("setupFee", event.target.value)}
            style={INPUT_STYLE}
          />
        </Field>

        <div
          style={{
            borderRadius: radius.lg,
            background: colors.surface,
            border: `1px solid ${colors.rule}`,
            padding: space.lg,
          }}
        >
          <div
            style={{
              display: "grid",
              gap: space.sm,
              fontSize: size.sm,
              color: colors.inkMuted,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span>מוצר</span>
              <strong style={{ color: colors.ink }}>Non-woven bag</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>צבע</span>
              <strong style={{ color: colors.ink }}>{bagColor}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>לוגו</span>
              <strong style={{ color: hasLogo ? colors.success : colors.warning }}>
                {hasLogo ? "Uploaded" : "Not uploaded"}
              </strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Unit price</span>
              <strong style={{ color: colors.ink }}>{formatCurrency(pricingInfo.unitPrice)}</strong>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Setup fee</span>
              <strong style={{ color: colors.ink }}>{formatCurrency(pricingInfo.setupFee)}</strong>
            </div>
            <div
              className="flex items-center justify-between gap-3"
              style={{
                paddingTop: space.sm,
                borderTop: `1px solid ${colors.rule}`,
                fontSize: size.md,
              }}
            >
              <span style={{ color: colors.ink, fontWeight: weight.medium }}>Total</span>
              <strong style={{ color: colors.accent }}>{formatCurrency(pricingInfo.totalPrice)}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PricingContractForm;
