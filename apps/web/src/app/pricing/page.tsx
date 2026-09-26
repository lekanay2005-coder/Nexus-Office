import type { Metadata } from "next";
import Link from "next/link";
import NexusLogo from "@/components/brand/NexusLogo";

export const metadata: Metadata = {
  title: "Pricing",
};

// Addendum 7: public pricing page. Two tiers only — Free and Pro (gated by the
// existing per-project `is_pro` flag from Addendum 4). No payment table, no
// Stripe: the upgrade flow is stubbed until explicitly requested.

const FREE_FEATURES = [
  "Unlimited projects",
  "Full 5-role pipeline",
  "GitHub storage + deploy",
  "Prompt Vault, Memory Board, Audit Log",
  "Bring-your-own API keys (Integrations panel)",
  "Nexus Office watermark on preview + deployed sites",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Watermark removed — preview + deployed sites",
  "Priority support badge in Settings",
  "Optional: bundled AI credits — no BYO keys needed",
];

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm text-neutral-200">
      <span className="text-emerald-400">✓</span>
      {children}
    </li>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm text-neutral-400">
      <span className="text-neutral-600">✓</span>
      {children}
    </li>
  );
}

export default function PricingPage() {
  return (
    <div className="min-h-screen text-neutral-100">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-10 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <NexusLogo surface="nav" />
            <span className="text-sm font-semibold">Nexus Office</span>
          </Link>
          <Link
            href="/login"
            className="rounded bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
          >
            Open app
          </Link>
        </div>

        <h1 className="text-3xl font-bold">Pricing</h1>
        <p className="mt-2 text-neutral-400">
          Start free. Upgrade when the watermark starts to bother you.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {/* Free */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="text-lg font-semibold">Free</h2>
            <p className="mt-1 text-3xl font-bold">
              $0<span className="text-sm font-normal text-neutral-500">/mo</span>
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              The whole office. Bring your own keys.
            </p>
            <ul className="mt-5 space-y-2">
              {FREE_FEATURES.map((f) => (
                <Check key={f}>{f}</Check>
              ))}
            </ul>
            <Link
              href="/login"
              className="mt-6 block rounded-md border border-neutral-700 px-4 py-2.5 text-center text-sm font-medium text-neutral-100 hover:border-neutral-500"
            >
              Start building free
            </Link>
          </div>

          {/* Pro */}
          <div className="rounded-xl border border-violet-900/60 bg-neutral-900 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pro</h2>
              <span className="rounded-full bg-violet-600/30 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                No watermark
              </span>
            </div>
            <p className="mt-1 text-3xl font-bold">
              TBD<span className="text-sm font-normal text-neutral-500">/mo</span>
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              For shipped work — clean builds, priority help.
            </p>
            <ul className="mt-5 space-y-2">
              {PRO_FEATURES.map((f) => (
                <Check key={f}>{f}</Check>
              ))}
            </ul>
            <ul className="mt-2 space-y-2">
              <Muted>Bundled AI credits are opt-in at launch</Muted>
            </ul>
            {/* Stubbed until Stripe is explicitly requested. */}
            <button
              type="button"
              disabled
              title="Coming soon"
              className="mt-6 block w-full cursor-not-allowed rounded-md bg-violet-600 px-4 py-2.5 text-center text-sm font-medium text-white opacity-60"
            >
              Upgrade to Pro — coming soon
            </button>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-neutral-600">
          Pro is tracked per project via the existing <code>is_pro</code> flag —
          no payment integration yet.
        </p>
      </div>
    </div>
  );
}
