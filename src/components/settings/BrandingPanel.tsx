"use client";

import { useState } from "react";
import NexusWatermark from "@/components/brand/NexusWatermark";
import type { Project } from "@/types/db";

// Addendum 4: per-project watermark/branding settings. All three flags live on
// the project row; nothing existing changes.
export default function BrandingPanel({
  project,
  onChanged,
}: {
  project: Project;
  onChanged?: (patch: {
    is_pro?: boolean;
    show_preview_watermark?: boolean;
    watermark_deployed_site?: boolean;
  }) => void;
}) {
  const [isPro, setIsPro] = useState(project.is_pro);
  const [previewWatermark, setPreviewWatermark] = useState(project.show_preview_watermark);
  const [deployWatermark, setDeployWatermark] = useState(project.watermark_deployed_site);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: {
    is_pro?: boolean;
    show_preview_watermark?: boolean;
    watermark_deployed_site?: boolean;
  }) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to save branding settings");
    } else {
      onChanged?.(patch); // let the parent react immediately (e.g. live preview)
    }
    setSaving(false);
  }

  function togglePreview() {
    const next = !previewWatermark;
    setPreviewWatermark(next);    save({ show_preview_watermark: next });
  }

  function toggleDeploy() {
    const next = !deployWatermark;
    setDeployWatermark(next);
    save({ watermark_deployed_site: next });
  }

  function togglePro() {
    const next = !isPro;
    setIsPro(next);
    save({ is_pro: next });
  }

  const deployLocked = isPro; // pro projects never carry the deployed-site badge

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Branding</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Nexus Office watermark — injected at preview/deploy time only. Your source files are
        never modified.
      </p>

      <div className="space-y-2">
        <ToggleRow
          label="Show Nexus Office watermark in preview"
          hint="Appears in the Code Canvas live preview."
          checked={previewWatermark}
          disabled={saving}
          onToggle={togglePreview}
        />
        <ToggleRow
          label="Include watermark on deployed site"
          hint={
            isPro
              ? "Pro project — watermark on deployed sites is always off."
              : "On by default for free-tier projects. Ops appends it to HTML at deploy time."
          }
          checked={deployLocked ? false : deployWatermark}
          disabled={saving || deployLocked}
          onToggle={toggleDeploy}
        />
        <ToggleRow
          label="Pro project"
          hint="Marks this project as paid. Ready to gate behind a future paid plan."
          checked={isPro}
          disabled={saving}
          onToggle={togglePro}
        />
      </div>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-5 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
        <p className="mb-2 text-xs text-neutral-500">Badge preview:</p>
        <div className="relative h-14 overflow-hidden rounded border border-neutral-800 bg-neutral-900">
          <NexusWatermark />
        </div>
        <p className="mt-2 text-[11px] text-neutral-600">
          Low opacity until hovered; the × hides it for this browser session only.
        </p>
      </div>
    </section>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-neutral-600">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={onToggle}
        className={`relative h-5 w-9 flex-none rounded-full transition-colors ${
          checked ? "bg-violet-600" : "bg-neutral-700"
        } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
