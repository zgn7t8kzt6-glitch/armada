// EverTide brand assets, recreated as vector art from the supplied logo:
// a lowercase "e" whose crossbar flows through as a tide wave, plus the
// lowercase geometric wordmark. Drawn with currentColor so the same mark
// works in sea-glass, deep tide, or white.

export function TideMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden fill="none">
      {/* ring with the "e" opening at the lower right */}
      <circle
        cx="50"
        cy="52"
        r="30"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray="154 34.5"
        transform="rotate(28 50 52)"
      />
      {/* tide crossbar flowing beyond the ring on both sides */}
      <path
        d="M2 60 C 20 46, 34 43, 52 49 C 70 55, 82 52, 98 38"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandWordmark({
  className = "",
  markClass = "h-7 w-7",
  textClass = "text-xl",
}: {
  className?: string;
  markClass?: string;
  textClass?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <TideMark className={markClass} />
      <span className={`font-brand lowercase leading-none tracking-tight ${textClass}`}>evertide</span>
    </span>
  );
}
