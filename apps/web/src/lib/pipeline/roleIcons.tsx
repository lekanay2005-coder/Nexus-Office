import type { Role } from "@/types/db";

type IconProps = { className?: string };

function CompassIcon({ className }: IconProps) {
  // Strategist — sets direction
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M15 9l-2 5-5 2 2-5 5-2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HammerIcon({ className }: IconProps) {
  // Builder — makes things
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M14.5 6.5l3 3-1.6 1.6-3-3 1.6-1.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13 8L5 16a1.5 1.5 0 0 0 0 2.1l0.9.9a1.5 1.5 0 0 0 2.1 0L16 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MagnifierIcon({ className }: IconProps) {
  // Analyst — inspects the work
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15 15l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ShieldCheckIcon({ className }: IconProps) {
  // QA — guards correctness
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3.5l6.5 2.4v5.2c0 4.2-2.7 7.4-6.5 8.9-3.8-1.5-6.5-4.7-6.5-8.9V5.9L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 12.2l2 2 4-4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RocketIcon({ className }: IconProps) {
  // Ops — ships the result
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 3c2.2 1.4 3.6 4 3.6 7.3 0 1.9-.5 3.5-1.3 4.7l-2.3 2.6-2.3-2.6c-.8-1.2-1.3-2.8-1.3-4.7C8.4 7 9.8 4.4 12 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 16l-2 3.5M15 16l2 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export const ROLE_ICONS: Record<Role, (props: IconProps) => React.ReactElement> = {
  strategist: CompassIcon,
  builder: HammerIcon,
  analyst: MagnifierIcon,
  qa: ShieldCheckIcon,
  ops: RocketIcon,
};
