import { ROLE_LABELS, ROLE_COLORS } from "@/lib/pipeline/roles";
import type { Role } from "@/types/db";

export default function RoleMessage({
  role,
  content,
  model,
}: {
  role: Role;
  content: string;
  model?: string | null;
}) {
  const color = ROLE_COLORS[role];
  const initial = ROLE_LABELS[role][0];

  return (
    <div className="flex gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
        style={{ backgroundColor: color }}
        title={ROLE_LABELS[role]}
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color }}>
            {ROLE_LABELS[role]}
          </span>
          {model && <span className="text-[11px] text-neutral-500">{model}</span>}
        </div>
        <div className="whitespace-pre-wrap rounded-lg rounded-tl-none border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200">
          {content}
        </div>
      </div>
    </div>
  );
}
