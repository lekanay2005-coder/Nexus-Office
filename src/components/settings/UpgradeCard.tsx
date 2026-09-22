import Link from "next/link";

// Addendum 7: plan status + upgrade entry point on the Settings page.
// The actual payment flow is a stub until Stripe is explicitly requested.
export default function UpgradeCard({ isPro }: { isPro: boolean }) {
  if (isPro) {
    return (
      <section>
        <h2 className="mb-1 text-lg font-semibold">Plan</h2>
        <div className="flex items-center gap-3 rounded-lg border border-emerald-900/60 bg-neutral-900 px-3 py-2">
          <span className="rounded-full bg-emerald-600/30 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
            Pro
          </span>
          <span className="rounded-full bg-violet-600/30 px-2 py-0.5 text-[11px] font-medium text-violet-300">
            Priority support
          </span>
          <span className="text-xs text-neutral-500">
            Watermark removed on preview and deployed sites for this project.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Plan</h2>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
        <div>
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] font-medium text-neutral-300">
            Free
          </span>
          <p className="mt-1 text-xs text-neutral-500">
            Pro removes the watermark from preview and deployed sites.
          </p>
        </div>
        <Link
          href="/pricing"
          className="shrink-0 rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
        >
          Upgrade to Pro
        </Link>
      </div>
    </section>
  );
}
