import { V2Chrome } from "../_components/V2Chrome";

export default function DashboardV2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <V2Chrome>{children}</V2Chrome>;
}
