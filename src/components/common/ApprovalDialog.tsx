"use client";

import { useCallback, useState } from "react";

// Addendum 3 approval-gating for the React app: wraps a fetch so that a
// 409 APPROVAL_REQUIRED response raises a confirm dialog with the server's
// summary and, on approval, retries the request with confirmed=true.
// Rejections are audit-logged client-side (approvals are logged
// server-side when the confirmed request executes).

interface Approval {
  kind: string;
  title: string;
  lines: string[];
}

export function useApprovalFlow(projectId: string) {
  const [dialog, setDialog] = useState<
    { approval: Approval; resolve: (v: boolean) => void } | null
  >(null);

  const ask = useCallback(
    (approval: Approval) =>
      new Promise<boolean>((resolve) => setDialog({ approval, resolve })),
    []
  );

  const fetchWithApproval = useCallback(
    async (
      url: string,
      init: RequestInit = {}
    ): Promise<{ res: Response; data: Record<string, unknown> }> => {
      const attempt = (confirmed: boolean) => {
        if (!confirmed) return fetch(url, init);
        if (typeof init.body === "string") {
          try {
            const body = JSON.parse(init.body);
            body.confirmed = true;
            return fetch(url, { ...init, body: JSON.stringify(body) });
          } catch {
            // fall through to query-param form
          }
        }
        return fetch(`${url}${url.includes("?") ? "&" : "?"}confirmed=true`, init);
      };

      let res = await attempt(false);
      let data = await res.json().catch(() => ({}));

      if (res.status === 409 && data?.approval) {
        const approved = await ask(data.approval as Approval);
        if (!approved) {
          fetch(`/api/projects/${projectId}/audit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "approval.rejected",
              target: (data.approval as Approval).kind,
              metadata: { kind: (data.approval as Approval).kind },
            }),
          }).catch(() => {});
          return { res, data: { ...data, cancelled: true } };
        }
        res = await attempt(true);
        data = await res.json().catch(() => ({}));
      }

      return { res, data };
    },
    [projectId, ask]
  );

  function decide(value: boolean) {
    setDialog((current) => {
      current?.resolve(value);
      return null;
    });
  }

  const dialogEl = dialog ? (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={dialog.approval.title}
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--panel-border)] bg-[#12151ce6] p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-neutral-100">
          {dialog.approval.title}
        </h3>
        <p className="mt-1 text-xs text-neutral-400">
          This is a production action. Review exactly what will happen:
        </p>
        <ul className="mt-3 space-y-1.5 rounded-xl border border-white/5 bg-black/30 p-3 font-mono text-[11px] text-neutral-300">
          {dialog.approval.lines.map((line, i) => (
            <li key={i}>› {line}</li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => decide(false)}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={() => decide(true)}
            className="rounded-lg bg-[var(--role-ops)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { fetchWithApproval, dialogEl };
}
