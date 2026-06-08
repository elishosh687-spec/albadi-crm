"use client";

import React, { useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { BAG_COLORS, getColorByHex } from "@/lib/constants/bagColors";
import ColorPalette from "./ColorPalette";
import LogoUploader from "./LogoUploader";
import LogoControls from "./LogoControls";
import PricingContractForm from "./PricingContractForm";
import DownloadPdfButton from "./DownloadPdfButton";

// Dynamic import for 3D viewer (no SSR needed)
const BagViewer3D = dynamic(() => import("./BagViewer3D"), { ssr: false });

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

export const ProductConfigurator: React.FC = () => {
  // Bag configuration state
  const [selectedColorHex, setSelectedColorHex] = useState<string>("#111111");
  const [selectedColorName, setSelectedColorName] = useState<string>("Black");
  
  // Logo state
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoScale, setLogoScale] = useState(1);
  const [logoPositionX, setLogoPositionX] = useState(0);
  const [logoPositionY, setLogoPositionY] = useState(0.2);
  const [logoRotation, setLogoRotation] = useState(0);

  // Customer & pricing state
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>({
    name: "",
    email: "",
    phone: "",
    company: "",
    quantity: 100,
    notes: "",
  });

  const [pricingInfo, setPricingInfo] = useState<PricingInfo>({
    unitPrice: 2.5,
    setupFee: 50,
    quantity: 100,
    totalPrice: 300,
  });

  const screenshotCallbackRef = useRef<(() => Promise<string>) | null>(null);

  const handleColorSelect = (hex: string, name: string) => {
    setSelectedColorHex(hex);
    setSelectedColorName(name);
  };

  const handleLogoUpload = (dataUrl: string | null) => {
    setLogoUrl(dataUrl);
  };

  const handleScreenshotReady = (callback: () => Promise<string>) => {
    screenshotCallbackRef.current = callback;
  };

  const getScreenshot = useCallback(async (): Promise<string> => {
    if (screenshotCallbackRef.current) {
      return screenshotCallbackRef.current();
    }
    return "";
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Bag 3D Configurator
          </h1>
          <p className="text-lg text-gray-600">
            Design your perfect custom non-woven bag
          </p>
        </div>

        {/* Main Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          {/* Left Column: 3D Viewer */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden h-full min-h-[600px]">
              <React.Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-12 h-12 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
                      <p className="text-gray-600">Loading 3D Viewer...</p>
                    </div>
                  </div>
                }
              >
                <BagViewer3D
                  bagColor={selectedColorHex}
                  logoUrl={logoUrl}
                  logoScale={logoScale}
                  logoPositionX={logoPositionX}
                  logoPositionY={logoPositionY}
                  logoRotation={logoRotation}
                  onScreenshotReady={handleScreenshotReady}
                />
              </React.Suspense>
            </div>
          </div>

          {/* Right Column: Controls */}
          <div className="space-y-6">
            {/* Color Selection */}
            <div className="bg-white p-6 rounded-lg shadow-lg">
              <ColorPalette
                selectedColor={selectedColorHex}
                onColorSelect={handleColorSelect}
              />
            </div>

            {/* Logo Upload */}
            <div className="bg-white p-6 rounded-lg shadow-lg">
              <LogoUploader
                onLogoUpload={handleLogoUpload}
                uploadedLogoUrl={logoUrl}
              />
            </div>

            {/* Logo Controls */}
            <div className="bg-white p-6 rounded-lg shadow-lg">
              <LogoControls
                logoScale={logoScale}
                logoPositionX={logoPositionX}
                logoPositionY={logoPositionY}
                logoRotation={logoRotation}
                onScaleChange={setLogoScale}
                onPositionXChange={setLogoPositionX}
                onPositionYChange={setLogoPositionY}
                onRotationChange={setLogoRotation}
                hasLogo={!!logoUrl}
              />
            </div>
          </div>
        </div>

        {/* Bottom Section: Customer Info & PDF */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Customer Form */}
          <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-lg">
            <PricingContractForm
              bagColor={selectedColorName}
              hasLogo={!!logoUrl}
              onCustomerInfoChange={setCustomerInfo}
              onPricingChange={setPricingInfo}
            />
          </div>

          {/* PDF Download */}
          <div className="bg-white p-6 rounded-lg shadow-lg h-fit">
            <DownloadPdfButton
              customerInfo={customerInfo}
              pricingInfo={pricingInfo}
              bagColorName={selectedColorName}
              bagColorHex={selectedColorHex}
              hasLogo={!!logoUrl}
              screenshotCallback={getScreenshot}
              disabled={!customerInfo.name || !customerInfo.email || !customerInfo.phone}
            />
          </div>
        </div>

        {/* Features Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-12">
          <div className="bg-white p-4 rounded-lg shadow text-center">
            <div className="text-2xl mb-2">🎨</div>
            <h3 className="font-semibold text-gray-800 mb-1">30+ Colors</h3>
            <p className="text-sm text-gray-600">Wide range of colors to choose from</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow text-center">
            <div className="text-2xl mb-2">🖼️</div>
            <h3 className="font-semibold text-gray-800 mb-1">Logo Upload</h3>
            <p className="text-sm text-gray-600">PNG, JPG, JPEG, or SVG support</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow text-center">
            <div className="text-2xl mb-2">3D</div>
            <h3 className="font-semibold text-gray-800 mb-1">Live Preview</h3>
            <p className="text-sm text-gray-600">See your design in real-time</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow text-center">
            <div className="text-2xl mb-2">📄</div>
            <h3 className="font-semibold text-gray-800 mb-1">PDF Contract</h3>
            <p className="text-sm text-gray-600">Download pricing and mockup</p>
          </div>
        </div>

        {/* Footer Info */}
        <div className="text-center mt-12 text-gray-600 text-sm">
          <p>
            💡 Rotate and zoom the 3D bag using your mouse. Adjust logo position and size
            with the controls.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ProductConfigurator;
