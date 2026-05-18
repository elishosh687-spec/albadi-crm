import { FactoryPricingForm } from "./FactoryPricingForm";
import { TemplatesSection } from "./TemplatesSection";
import { getFactoryConfig } from "@/lib/factory/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function V3SettingsPage() {
  const factoryConfig = await getFactoryConfig({ fresh: true });
  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <FactoryPricingForm initial={factoryConfig} />
      <TemplatesSection />
    </div>
  );
}
