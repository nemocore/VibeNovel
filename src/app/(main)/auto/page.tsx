import { listAutoRuns } from "@/lib/storage/auto-runs";
import { AutoDashboard } from "@/components/auto/auto-dashboard";

export const dynamic = "force-dynamic";

export default async function AutoPage() {
  const runs = await listAutoRuns().catch(() => []);
  return <AutoDashboard initialRuns={runs} />;
}
