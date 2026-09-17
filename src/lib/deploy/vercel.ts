const VERCEL_API = "https://api.vercel.com";

export interface VercelDeployment {
  id: string;
  url: string;
  readyState: "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED" | string;
  createdAt: number;
  meta?: Record<string, string>;
}

// Finds the most recent deployment for this Vercel project. Assumes the
// project already has GitHub auto-deploy configured on Vercel's side
// (done once, outside this app, when the user imports the repo) — pushing
// a commit is what actually triggers the deploy; this just reports status.
export async function getLatestDeployment(
  token: string,
  vercelProjectId: string,
  teamId?: string
): Promise<VercelDeployment | null> {
  const params = new URLSearchParams({ projectId: vercelProjectId, limit: "1" });
  if (teamId) params.set("teamId", teamId);

  const res = await fetch(`${VERCEL_API}/v6/deployments?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Vercel API failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  const deployment = data.deployments?.[0];
  if (!deployment) return null;

  return {
    id: deployment.uid,
    url: deployment.url,
    readyState: deployment.state ?? deployment.readyState,
    createdAt: deployment.createdAt ?? deployment.created,
    meta: deployment.meta,
  };
}

export function mapVercelStateToDeployStatus(
  state: string
): "pending" | "building" | "ready" | "error" {
  switch (state) {
    case "READY":
      return "ready";
    case "ERROR":
    case "CANCELED":
      return "error";
    case "QUEUED":
      return "pending";
    default:
      return "building";
  }
}
