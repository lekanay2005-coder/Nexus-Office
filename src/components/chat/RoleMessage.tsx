import { ROLE_LABELS, ROLE_COLORS } from "@/lib/pipeline/roles";
import { ROLE_ICONS } from "@/lib/pipeline/roleIcons";
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
  const Icon = ROLE_ICONS[role];
  const isOps = role === "ops";

  return (
    <div className="flex gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: color }}
        title={ROLE_LABELS[role]}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color }}>
            {ROLE_LABELS[role]}
          </span>
          {model && <span className="font-mono text-[11px] text-neutral-500">{model}</span>}
        </div>
        <div
          className={`glass-panel whitespace-pre-wrap rounded-lg rounded-tl-none px-3 py-2 text-sm text-neutral-200 ${
            isOps ? "text-[15px]" : ""
          }`}
          style={isOps ? { borderColor: `${color}55` } : undefined}
        >
          {content}
        </div>
      </div>
    </div>
  );
}
