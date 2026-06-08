import React from "react";
import ProductConfigurator from "@/components/configurator/ProductConfigurator";

export const metadata = {
  title: "3D Bag Configurator | Albadi Bags",
  description: "Design your custom non-woven bags with our 3D configurator. Choose colors, upload your logo, and download a pricing contract.",
};

export default function ConfiguratorPage() {
  return <ProductConfigurator />;
}
