import { TemplatesSection } from "./TemplatesSection";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function V3SettingsPage() {
  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <TemplatesSection />
    </div>
  );
}
