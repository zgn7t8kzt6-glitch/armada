// EverTide brand assets — the exact supplied artwork (wave-e mark and
// lowercase wordmark), background removed, in the two official colorways:
// sage (sea glass) for light surfaces and cream for deep-tide surfaces.
import Image from "next/image";
import markSage from "@/assets/brand/mark-sage.png";
import markCream from "@/assets/brand/mark-cream.png";
import wordmarkSage from "@/assets/brand/wordmark-sage.png";
import wordmarkCream from "@/assets/brand/wordmark-cream.png";

type Colorway = "sage" | "cream";

export function TideMark({
  className = "h-8 w-auto",
  variant = "sage",
}: { className?: string; variant?: Colorway }) {
  return (
    <Image
      src={variant === "cream" ? markCream : markSage}
      alt=""
      aria-hidden
      priority
      className={className}
    />
  );
}

export function BrandWordmark({
  className = "",
  markClass = "h-7 w-auto",
  textClass = "h-4 w-auto",
  variant = "sage",
}: {
  className?: string;
  markClass?: string;
  textClass?: string;
  variant?: Colorway;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <TideMark className={markClass} variant={variant} />
      <Image
        src={variant === "cream" ? wordmarkCream : wordmarkSage}
        alt="evertide"
        priority
        className={textClass}
      />
    </span>
  );
}
