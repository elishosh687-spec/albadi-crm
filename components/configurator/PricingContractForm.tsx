"use client";

import React, { useState, useEffect } from "react";

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  company?: string;
  quantity: number;
  notes?: string;
}

interface PricingInfo {
  unitPrice: number;
  setupFee: number;
  quantity: number;
  totalPrice: number;
}

interface PricingContractFormProps {
  bagColor: string;
  hasLogo: boolean;
  onCustomerInfoChange: (info: CustomerInfo) => void;
  onPricingChange: (pricing: PricingInfo) => void;
}

const calculateUnitPrice = (quantity: number): number => {
  if (quantity < 100) return 2.5;
  if (quantity < 500) return 2.0;
  if (quantity < 1000) return 1.7;
  return 1.5;
};

export const PricingContractForm: React.FC<PricingContractFormProps> = ({
  bagColor,
  hasLogo,
  onCustomerInfoChange,
  onPricingChange,
}) => {
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: "",
    email: "",
    phone: "",
    company: "",
    quantity: 100,
    notes: "",
  });

  const [pricing, setPricing] = useState<PricingInfo>({
    unitPrice: 2.5,
    setupFee: 50,
    quantity: 100,
    totalPrice: 2.5 * 100 + 50,
  });

  // Update pricing when quantity changes
  useEffect(() => {
    const unitPrice = calculateUnitPrice(customerInfo.quantity);
    const totalPrice =
      unitPrice * customerInfo.quantity + pricing.setupFee;

    const newPricing: PricingInfo = {
      unitPrice,
      setupFee: pricing.setupFee,
      quantity: customerInfo.quantity,
      totalPrice,
    };

    setPricing(newPricing);
    onPricingChange(newPricing);
  }, [customerInfo.quantity, pricing.setupFee]);

  const handleCustomerChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const updated = {
      ...customerInfo,
      [name]: name === "quantity" ? parseInt(value) || 0 : value,
    };
    setCustomerInfo(updated);
    onCustomerInfoChange(updated);
  };

  return (
    <div className="space-y-6">
      {/* Customer Information */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">
          Customer Information
        </h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Full Name *
          </label>
          <input
            type="text"
            name="name"
            value={customerInfo.name}
            onChange={handleCustomerChange}
            placeholder="John Doe"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email *
          </label>
          <input
            type="email"
            name="email"
            value={customerInfo.email}
            onChange={handleCustomerChange}
            placeholder="john@example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Phone *
          </label>
          <input
            type="tel"
            name="phone"
            value={customerInfo.phone}
            onChange={handleCustomerChange}
            placeholder="+1 (555) 123-4567"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Company Name
          </label>
          <input
            type="text"
            name="company"
            value={customerInfo.company}
            onChange={handleCustomerChange}
            placeholder="Your Company"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            name="notes"
            value={customerInfo.notes}
            onChange={handleCustomerChange}
            placeholder="Additional notes..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Order Details */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">Order Details</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Quantity *
          </label>
          <input
            type="number"
            name="quantity"
            value={customerInfo.quantity}
            onChange={handleCustomerChange}
            min="1"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="bg-gray-50 p-4 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Unit Price:</span>
            <span className="font-semibold">${pricing.unitPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Quantity:</span>
            <span className="font-semibold">{pricing.quantity}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Setup Fee:</span>
            <span className="font-semibold">${pricing.setupFee.toFixed(2)}</span>
          </div>
          <div className="border-t border-gray-300 pt-2 flex justify-between">
            <span className="font-semibold text-gray-700">Total Price:</span>
            <span className="text-lg font-bold text-blue-600">
              ${pricing.totalPrice.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded">
          <p>
            <strong>Pricing Tiers:</strong> 1-99: $2.50/unit | 100-499:
            $2.00/unit | 500-999: $1.70/unit | 1000+: $1.50/unit
          </p>
        </div>
      </div>

      {/* Product Summary */}
      <div className="space-y-2 bg-amber-50 p-4 rounded-lg border border-amber-200">
        <h3 className="text-sm font-semibold text-gray-700">Product Summary</h3>
        <div className="text-sm space-y-1">
          <p>
            <strong>Product:</strong> Non-woven custom tote bag
          </p>
          <p>
            <strong>Color:</strong> <span className="capitalize">{bagColor}</span>
          </p>
          <p>
            <strong>Logo:</strong>{" "}
            {hasLogo ? (
              <span className="text-green-600 font-semibold">✓ Included</span>
            ) : (
              <span className="text-gray-600">Not yet</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};

export default PricingContractForm;
