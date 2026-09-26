import Link from "next/link";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/pipeline/roles";
import { ROLE_ICONS } from "@/lib/pipeline/roleIcons";
import { ROLES, type Role } from "@/types/db";
import RelayDemo from "./RelayDemo";

const ROLE_TAGLINES: Record<Role, string> = {
  strategist: "Reads the ask, decides how much ceremony it actually needs.",
  builder: "Writes the real code and files, straight into your project.",
  analyst: "Reviews the build for edge cases and gaps before it ships.",
  qa: "Runs a final correctness pass and flags what to test.",
  ops: "Delivers the answer and logs what changed, permanently.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen text-neutral-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="text-sm font-semibold tracking-wide">Nexus Office</span>
        <nav className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-neutral-400 hover:text-neutral-200">
            Log in
          </Link>
          <Link
            href="/login"
            className="rounded-md bg-[var(--role-strategist)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Sign up
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-20 pt-12 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Your AI dev team.
          <br />
          Persistent. In one app.
        </h1>
        <p className="mt-5 max-w-xl text-balance text-neutral-400">
          Nexus Office gives every project a 5-role AI team — Strategist, Builder, Analyst,
          QA, Ops — that remembers your decisions, writes code into a live editor, and ships
          it. No more juggling six tabs and losing context every new chat.
        </p>
        <div className="mt-8">
          <RelayDemo />
        </div>
        <div className="mt-8 flex gap-3">
          <Link
            href="/login"
            className="rounded-md bg-[var(--role-strategist)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Get started free
          </Link>
        </div>
      </section>

      {/* The 5 roles */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <h2 className="mb-8 text-center text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Five roles, one relay
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {ROLES.map((role) => {
            const Icon = ROLE_ICONS[role];
            const color = ROLE_COLORS[role];
            return (
              <div key={role} className="glass-panel rounded-xl p-5">
                <div
                  className="mb-3 flex h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: color }}
                >
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <h3 className="mb-1 text-sm font-semibold" style={{ color }}>
                  {ROLE_LABELS[role]}
                </h3>
                <p className="text-xs leading-relaxed text-neutral-400">
                  {ROLE_TAGLINES[role]}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Before / after */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="glass-panel rounded-xl p-6">
            <h3 className="mb-3 text-sm font-semibold text-neutral-400">
              Without Nexus Office
            </h3>
            <ul className="space-y-2 text-sm text-neutral-500">
              <li>— A chat tab that forgets everything tomorrow</li>
              <li>— A separate editor for the actual code</li>
              <li>— A notes doc for decisions, if you remember to write one</li>
              <li>— A deploy dashboard in a third tab</li>
              <li>— No idea what any of it cost this month</li>
            </ul>
          </div>
          <div className="glass-panel rounded-xl p-6" style={{ borderColor: "var(--role-analyst)" }}>
            <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--role-analyst)" }}>
              With Nexus Office
            </h3>
            <ul className="space-y-2 text-sm text-neutral-300">
              <li>— One workspace per project, memory included</li>
              <li>— Code lands directly in a live editor + preview</li>
              <li>— Every decision auto-logged by Ops, every run</li>
              <li>— Deploy straight to GitHub + Vercel from the same screen</li>
              <li>— A running cost meter, per role, per run</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 pb-12 text-center text-xs text-neutral-600">
        Nexus Office
      </footer>
    </div>
  );
}
