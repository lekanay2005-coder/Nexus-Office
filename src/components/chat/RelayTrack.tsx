import { ROLE_COLORS, ROLE_LABELS } from "@/lib/pipeline/roles";
import { ROLE_ICONS } from "@/lib/pipeline/roleIcons";
import type { Role } from "@/types/db";

export default function RelayTrack({
  sequence,
  completedCount,
  running,
}: {
  sequence: Role[];
  completedCount: number;
  running: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {sequence.map((role, i) => {
        const Icon = ROLE_ICONS[role];
        const color = ROLE_COLORS[role];
        const isDone = i < completedCount;
        const isActive = running && i === completedCount;
        const isUpcoming = !isDone && !isActive;

        return (
          <div key={role} className="flex items-center gap-1.5">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full ${isActive ? "role-glow" : ""}`}
              style={{
                backgroundColor: isDone || isActive ? color : "transparent",
                border: isUpcoming ? `1.5px solid ${color}55` : undefined,
                color: isUpcoming ? color : "#fff",
                opacity: isUpcoming ? 0.5 : 1,
                // @ts-expect-error -- custom property consumed by .role-glow's keyframes
                "--glow-color": color,
              }}
              title={ROLE_LABELS[role]}
            >
              <Icon className="h-3 w-3" />
            </div>
            {i < sequence.length - 1 && (
              <div
                className={`h-[2px] w-5 rounded-full ${isDone ? "" : isActive ? "relay-line-active" : ""}`}
                style={{
                  backgroundColor: isDone ? color : isActive ? undefined : "rgba(255,255,255,0.12)",
                  // @ts-expect-error -- custom property consumed by .relay-line-active
                  "--line-color": color,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
