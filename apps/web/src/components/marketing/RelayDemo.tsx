"use client";

import { useEffect, useState } from "react";
import RelayTrack from "@/components/chat/RelayTrack";
import type { Role } from "@/types/db";

const SEQUENCE: Role[] = ["strategist", "builder", "analyst", "qa", "ops"];
const STEP_MS = 900;
const PAUSE_MS = 1500;

export default function RelayDemo() {
  const [completed, setCompleted] = useState(0);

  useEffect(() => {
    let cancelled = false;

    function tick(count: number) {
      if (cancelled) return;
      setCompleted(count);
      const delay = count >= SEQUENCE.length ? PAUSE_MS : STEP_MS;
      const next = count >= SEQUENCE.length ? 0 : count + 1;
      setTimeout(() => tick(next), delay);
    }

    const timer = setTimeout(() => tick(1), STEP_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="glass-panel inline-flex rounded-full px-4 py-3">
      <RelayTrack
        sequence={SEQUENCE}
        completedCount={Math.min(completed, SEQUENCE.length)}
        running={completed < SEQUENCE.length}
      />
    </div>
  );
}
