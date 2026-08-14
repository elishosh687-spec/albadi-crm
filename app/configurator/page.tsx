import React, { Suspense } from "react";
import ProductConfigurator from "@/components/configurator/ProductConfigurator";

export const metadata = {
  title: "3D Bag Configurator | Albadi Bags",
  description: "Design your custom non-woven bags with our 3D configurator. Choose colors, upload your logo, and download a pricing contract.",
};

export default function ConfiguratorPage() {
  return (
    // `.mfit` opts this route into the mobile layer in globals.css. The 3D tab
    // renders here, OUTSIDE app/widget/, so it never sees the widget layout's
    // scope class and would otherwise miss the iOS input-zoom fix.
    <div className="mfit">
      <Suspense fallback={<div style={{ minHeight: "100dvh", background: "#f0e9dc" }} />}>
        <ProductConfigurator />
      </Suspense>
    </div>
  );
}
