"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { sanitizeDisplayName } from "@/lib/profile";
import NexusLogo from "@/components/brand/NexusLogo";

type MeInfo = {
  displayName: string;
  avatarUrl: string | null;
  needsDisplayName: boolean;
  email: string | null;
  githubLogin: string | null;
  memberSince: string | null;
};

export default function ProfilePage() {
  const [info, setInfo] = useState<MeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me/display-name");
        if (res.ok) {
          const data = await res.json();
          setInfo(data);
          setNameDraft(data.displayName ?? "");
        }
      } catch {
        // stay in loading state
      }
      setLoading(false);
    })();
  }, []);

  async function saveName() {
    const trimmed = sanitizeDisplayName(nameDraft);
    if (!trimmed || !info) return;
    setSavingName(true);
    setStatus(null);
    try {
      const res = await fetch("/api/me/display-name", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus(data.error ?? "Failed to save");
      } else {
        const data = await res.json();
        setInfo((prev) => (prev ? { ...prev, displayName: data.displayName } : prev));
        setStatus("Display name saved");
      }
    } catch {
      setStatus("Failed to save");
    }
    setSavingName(false);
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !info) return;

    if (!file.type.startsWith("image/")) {
      setStatus("Please upload an image file (PNG, JPEG, WebP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setStatus("Image must be under 5 MB.");
      return;
    }

    setUploading(true);
    setStatus(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const ext = file.type.split("/")[1] ?? "png";
      const path = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });

      if (uploadError) {
        setStatus(uploadError.message);
        setUploading(false);
        return;
      }

      const { data: publicUrl } = supabase.storage.from("avatars").getPublicUrl(path);

      const res = await fetch("/api/me/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: publicUrl.publicUrl }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus(data.error ?? "Failed to update avatar");
      } else {
        setInfo((prev) =>
          prev ? { ...prev, avatarUrl: publicUrl.publicUrl } : prev
        );
        setStatus("Avatar updated");
      }
    } catch {
      setStatus("Upload failed");
    }
    setUploading(false);
    e.target.value = "";
  }

  async function removeAvatar() {
    if (!info) return;
    setUploading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/me/avatar", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus(data.error ?? "Failed to remove avatar");
      } else {
        setInfo((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
        setStatus("Avatar removed — using GitHub default");
      }
    } catch {
      setStatus("Failed to remove avatar");
    }
    setUploading(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-10 text-neutral-100">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-neutral-500">Loading…</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-screen px-6 py-10 text-neutral-100">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-red-400">Failed to load profile.</p>
        </div>
      </div>
    );
  }

  const avatar = info.avatarUrl;
  const displayName = info.displayName;
  const initials = (displayName || info.email || "U")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "U";

  return (
    <div className="min-h-screen px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <NexusLogo surface="nav" />
          <h1 className="text-2xl font-semibold">Account</h1>
          <Link href="/projects" className="ml-auto text-sm text-neutral-400 hover:text-neutral-200">
            ← Back to workspace
          </Link>
        </div>

        <div className="glass-panel space-y-6 rounded-xl p-6">
          <div>
            <h2 className="text-sm font-semibold text-neutral-300">Display name</h2>
            <p className="mb-2 text-xs text-neutral-500">
              How Nexus Office addresses you — in the nav, Memory Board, Audit Log,
              and as the author on your GitHub commits.
            </p>
            {loading ? (
              <p className="text-xs text-neutral-600">Loading…</p>
            ) : (
              <div className="flex gap-2">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && displayName?.trim() && saveName()}
                  placeholder="Your display name"
                  maxLength={60}
                  aria-label="Display name"
                  className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-500"
                />
                <button
                  onClick={saveName}
                  disabled={savingName || !nameDraft.trim()}
                  className="rounded-md bg-[var(--role-strategist)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingName ? "Saving…" : "Save"}
                </button>
              </div>
            )}
            {status && <p className={`mt-2 text-xs ${status.includes("saved") || status.includes("updated") || status.includes("removed") ? "text-emerald-400" : "text-amber-400"}`}>{status}</p>}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-neutral-300">Avatar</h2>
            <p className="mb-2 text-xs text-neutral-500">
              Shown in the nav avatar menu, Memory Board, and Audit Log. Defaults to
              your GitHub avatar if you signed up via GitHub.
            </p>

            <div className="flex items-start gap-6">
              <div className="relative h-28 w-28 shrink-0">
                {avatar ? (
                  <Image
                    src={avatar}
                    alt={displayName || "Your avatar"}
                    fill
                    className="rounded-full object-cover"
                    sizes="112px"
                  />
                ) : (
                  <span
                    className="flex h-full w-full items-center justify-center rounded-full text-3xl font-bold text-white"
                    style={{ background: "var(--role-strategist)" }}
                  >
                    {initials}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-900">
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M14.5 2.5l3 3 5-5 0 11.5a2.5 2.5 0 01-2.5 2.5H4a2 2 0 01-2-2V7a2 2 0 012-2h9z" />
                  </svg>
                  <span>Upload new avatar</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={uploadAvatar}
                    disabled={uploading}
                    className="hidden"
                    aria-label="Upload avatar image"
                  />
                </label>

                {info.avatarUrl && (
                  <button
                    onClick={removeAvatar}
                    disabled={uploading}
                    className="text-left text-xs text-neutral-500 hover:text-neutral-300"
                  >
                    Remove uploaded avatar
                  </button>
                )}
                {uploading && <p className="text-xs text-neutral-600">Uploading…</p>}
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-neutral-300">Account info</h2>
            <dl className="mt-2 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-neutral-500">Email</dt>
                <dd className="text-neutral-200">{info.email ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-neutral-500">GitHub account</dt>
                <dd className="text-neutral-200">
                  {info.githubLogin ? (
                    <a
                      href={`https://github.com/${info.githubLogin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-400 hover:text-violet-300"
                    >
                      @{info.githubLogin}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-neutral-500">Member since</dt>
                <dd className="text-neutral-200">
                  {info.memberSince
                    ? new Date(info.memberSince).toLocaleDateString()
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
