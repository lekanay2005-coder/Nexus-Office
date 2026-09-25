"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import ChatPanel, { type RunWithSteps } from "@/components/chat/ChatPanel";
import CodeCanvas from "@/components/canvas/CodeCanvas";
import ModelRouterPanel from "@/components/settings/ModelRouterPanel";
import ConnectionsPanel from "@/components/settings/ConnectionsPanel";
import IntegrationsPanel from "@/components/settings/IntegrationsPanel";
import BrandingPanel from "@/components/settings/BrandingPanel";
import UpgradeCard from "@/components/settings/UpgradeCard";
import NexusLogo from "@/components/brand/NexusLogo";
import AccountPanel from "@/components/settings/AccountPanel";
import DisplayNamePrompt from "@/components/account/DisplayNamePrompt";
import DeployDesk from "@/components/deploy/DeployDesk";
import MemoryBoard from "@/components/memory/MemoryBoard";
import CostMeter from "@/components/cost/CostMeter";
import AuditLog from "@/components/governance/AuditLog";
import PermissionsPanel from "@/components/governance/PermissionsPanel";
import type { Deploy, Integration, Project, ProjectFile, ProjectMemory, Role } from "@/types/db";
import type { ProviderName } from "@/lib/providers";

type Tab = "chat" | "canvas" | "memory" | "settings" | "deploy" | "cost" | "audit" | "permissions";
type ConnectionProvider = "github" | "vercel";

export default function OfficeWorkspace({
  project,
  displayName,
  avatarUrl,
  email,
  initialRuns,
  initialFiles,
  initialMemory,
  initialRoleModels,
  initialApiKeyProviders,
  initialConnectionProviders,
  initialDeploys,
  initialIntegrations,
}: {
  project: Project;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  initialRuns: RunWithSteps[];
  initialFiles: ProjectFile[];
  initialMemory: ProjectMemory | null;
  initialRoleModels: { role: Role; provider: string; model: string }[];
  initialApiKeyProviders: ProviderName[];
  initialConnectionProviders: ConnectionProvider[];
  initialDeploys: Deploy[];
  initialIntegrations: Integration[];
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const [canvasKey, setCanvasKey] = useState(0);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  // Local copy so BrandingPanel toggles (e.g. preview watermark) apply
  // immediately without a full refetch.
  const [projectState, setProjectState] = useState<Project>(project);

  function applyProjectPatch(patch: Partial<Project>) {
    setProjectState((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div className="flex h-screen flex-col text-neutral-100">
      {/* Addendum 9: one-time "What should we call you?" prompt — shows until
          a display name is saved (skipping defers it to the next visit). */}
      {displayName === "" && <DisplayNamePrompt />}
      <header className="glass-panel flex items-center justify-between border-x-0 border-t-0 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <NexusLogo surface="nav" className="shrink-0" />
          <Link href="/projects" className="shrink-0 text-sm text-neutral-500 hover:text-neutral-300">
            ← Projects
          </Link>
          <h1 className="truncate text-sm font-semibold">{projectState.name}</h1>
        </div>
        <nav className="flex gap-1 rounded-md bg-white/5 p-1">
          <TabButton active={tab === "chat"} onClick={() => setTab("chat")}>
            Office Chat
          </TabButton>
          <TabButton active={tab === "canvas"} onClick={() => setTab("canvas")}>
            Code Canvas
          </TabButton>
          <TabButton active={tab === "memory"} onClick={() => setTab("memory")}>
            Memory Board
          </TabButton>
          <TabButton active={tab === "deploy"} onClick={() => setTab("deploy")}>
            Deploy Desk
          </TabButton>
          <TabButton active={tab === "cost"} onClick={() => setTab("cost")}>
            Cost Meter
          </TabButton>
          <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>
            Audit
          </TabButton>
          <TabButton active={tab === "permissions"} onClick={() => setTab("permissions")}>
            Permissions
          </TabButton>
          <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
            Settings
          </TabButton>
        </nav>
        <Link href="/prompts" className="text-sm text-neutral-500 hover:text-neutral-200">
          Prompt Vault
        </Link>
        <UserAvatarMenu
          displayName={displayName}
          avatarUrl={avatarUrl}
          email={email ?? ""}
          open={avatarMenuOpen}
          onToggle={() => setAvatarMenuOpen((v) => !v)}
          onClose={() => setAvatarMenuOpen(false)}
        />
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
          <CodeCanvas
            key={canvasKey}
            projectId={projectState.id}
            initialFiles={initialFiles}
            showWatermark={projectState.show_preview_watermark}
          />
        )}
        {tab === "memory" && (
          <MemoryBoard
            projectId={project.id}
            initialMemory={initialMemory}
            displayName={displayName}
          />
        )}
        {tab === "deploy" && (
          <DeployDesk
            project={projectState}
            initialDeploys={initialDeploys}
            hostingIntegrations={initialIntegrations.filter((i) => i.type === "hosting")}
          />
        )}
        {tab === "cost" && <CostMeter projectId={project.id} />}
        {tab === "audit" && (
          <AuditLog projectId={project.id} displayName={displayName} />
        )}
        {tab === "permissions" && <PermissionsPanel projectId={project.id} />}
        {tab === "settings" && (
          <div className="space-y-10">
            <div className="mx-auto max-w-2xl px-6 pt-8">
              <AccountPanel />
            </div>
            <div className="mx-auto max-w-2xl px-6 pt-8">
              <UpgradeCard isPro={projectState.is_pro} />
            </div>
            <div className="mx-auto max-w-2xl px-6">
              <BrandingPanel project={projectState} onChanged={applyProjectPatch} />
            </div>
            <ModelRouterPanel
              projectId={project.id}
              initialRoleModels={initialRoleModels}
              initialApiKeyProviders={initialApiKeyProviders}
              customIntegrationNames={initialIntegrations
                .filter((i) => i.type === "ai_provider")
                .map((i) => i.name)}
            />
            <div className="mx-auto max-w-2xl px-6">
              <ConnectionsPanel initialConfigured={initialConnectionProviders} />
            </div>
            <div className="mx-auto max-w-2xl px-6 pb-8">
              <IntegrationsPanel projectId={project.id} initialIntegrations={initialIntegrations} />
            </div>
          </div>
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
      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
        active ? "bg-[var(--role-strategist)] text-white" : "text-neutral-400 hover:text-neutral-200"
      }`}
    >
       {children}
    </button>
  );
}

function UserAvatarMenu({
  displayName,
  avatarUrl,
  email,
  open,
  onToggle,
  onClose,
}: {
  displayName: string;
  avatarUrl: string | null;
  email: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const initials =
    (displayName || email)
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "U";

  return (
    <div className="relative shrink-0">
      <button
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-xs font-bold text-neutral-200 hover:bg-neutral-700 focus:outline-2 focus:outline-offset-2 focus:outline-[var(--role-strategist)]"
      >
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName || "Your avatar"}
            width={32}
            height={32}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            role="menu"
            className="absolute top-10 right-0 z-20 w-48 rounded-lg border border-neutral-800 bg-neutral-900 py-1 shadow-xl"
          >
            <div className="px-3 py-2 text-xs text-neutral-500">
              {displayName && <div className="font-medium text-neutral-200">{displayName}</div>}
              {email && <div className="truncate">{email}</div>}
            </div>
            <Link
              href="/account/profile"
              onClick={onClose}
              className="block px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
              role="menuitem"
            >
              Profile
            </Link>
            <form action="/auth/signout" method="post" className="m-0">
              <button
                type="submit"
                onClick={onClose}
                className="w-full px-3 py-1.5 text-left text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
                role="menuitem"
              >
                Sign out
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
