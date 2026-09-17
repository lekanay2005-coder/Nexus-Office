"use client";

import { useState } from "react";
import Link from "next/link";
import ChatPanel, { type RunWithSteps } from "@/components/chat/ChatPanel";
import CodeCanvas from "@/components/canvas/CodeCanvas";
import ModelRouterPanel from "@/components/settings/ModelRouterPanel";
import type { Project, ProjectFile, ProjectMemory, Role } from "@/types/db";
import type { ProviderName } from "@/lib/providers";

type Tab = "chat" | "canvas" | "settings";

export default function OfficeWorkspace({
  project,
  initialRuns,
  initialFiles,
  initialRoleModels,
  initialApiKeyProviders,
}: {
  project: Project;
  initialRuns: RunWithSteps[];
  initialFiles: ProjectFile[];
  initialMemory: ProjectMemory | null;
  initialRoleModels: { role: Role; provider: ProviderName; model: string }[];
  initialApiKeyProviders: ProviderName[];
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const [canvasKey, setCanvasKey] = useState(0);

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/projects" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Projects
          </Link>
          <h1 className="text-sm font-semibold">{project.name}</h1>
        </div>
        <nav className="flex gap-1 rounded-md bg-neutral-900 p-1">
          <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
            Office Chat
          </TabButton>
          <TabButton active={tab === "canvas"} onClick={() => setTab("canvas")}>
            Code Canvas
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
            Settings
          </TabButton>
        </nav>
        <Link href="/prompts" className="text-sm text-neutral-500 hover:text-neutral-300">
          Prompt Vault
        </Link>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "chat" && (
          <div className="mx-auto h-full max-w-3xl">
            <ChatPanel
              projectId={project.id}
              initialRuns={initialRuns}
              onFilesChanged={() => setCanvasKey((k) => k + 1)}
            />
          </div>
        )}
        {tab === "canvas" && (
          <CodeCanvas key={canvasKey} projectId={project.id} initialFiles={initialFiles} />
        )}
        {tab === "settings" && (
          <ModelRouterPanel
            projectId={project.id}
            initialRoleModels={initialRoleModels}
            initialApiKeyProviders={initialApiKeyProviders}
          />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-3 py-1 text-xs font-medium ${
        active ? "bg-violet-600 text-white" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}
