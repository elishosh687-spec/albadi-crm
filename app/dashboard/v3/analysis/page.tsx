import AnalysisViewV3 from "./AnalysisViewV3";

export const dynamic = "force-dynamic";

export default function AnalysisPage() {
  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <h1 className="text-xl font-semibold mb-4">🔍 ניתוח לידים</h1>
      <AnalysisViewV3 />
    </div>
  );
}
