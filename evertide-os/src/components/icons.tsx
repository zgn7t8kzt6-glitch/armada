// Minimal line-icon set (24×24, 2px stroke, currentColor) replacing the
// emoji placeholders — consistent weight, professional tone, no font
// dependency. Hand-authored in the style of contemporary stroke icon sets.
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function base(props: IconProps) {
  const { className = "h-4 w-4", ...rest } = props;
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export const HomeIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></svg>
);
export const ChecklistIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="m3 6 1.5 1.5L7 5" /><path d="m3 12 1.5 1.5L7 11" /><path d="m3 18 1.5 1.5L7 17" /><path d="M11 6h10M11 12h10M11 18h10" /></svg>
);
export const TargetIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.5" fill="currentColor" /></svg>
);
export const BoardIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v13" /></svg>
);
export const ChartIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 3v18h18" /><path d="M7 15v3M12 10v8M17 6v12" /></svg>
);
export const UsersIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /><path d="M15.5 4.9a3.5 3.5 0 0 1 0 6.2" /><path d="M17.5 15.3c2 .7 3.4 2.3 4 4.7" /></svg>
);
export const AlertIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4" /><path d="M12 17.2v.05" /></svg>
);
export const ShieldIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3 5 5.8v5.4c0 4.4 2.9 7.6 7 9.8 4.1-2.2 7-5.4 7-9.8V5.8L12 3Z" /></svg>
);
export const ScaleIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 4v16M8 20h8" /><path d="M12 6h6.5M12 6H5.5" /><path d="m5.5 6-2.8 6a3.2 3.2 0 0 0 5.6 0l-2.8-6ZM18.5 6l-2.8 6a3.2 3.2 0 0 0 5.6 0l-2.8-6Z" /></svg>
);
export const FolderIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>
);
export const FolderOpenIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V11" /><path d="M3 17V7m0 10a2 2 0 0 0 2 2h12.6a2 2 0 0 0 1.9-1.4L22 11H6.4a2 2 0 0 0-1.9 1.4L3 17Z" /></svg>
);
export const ContactsIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="2.5" /><path d="M8 17c.7-1.8 2.2-2.7 4-2.7s3.3.9 4 2.7" /></svg>
);
export const FileTextIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></svg>
);
export const TableIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9.5h18M3 15h18M9.5 9.5V20M15.5 9.5V20" /></svg>
);
export const SettingsIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M12 2.8 13.4 5a7.2 7.2 0 0 1 2.4 1l2.5-.7 1.4 2.4-1.8 1.9a7.3 7.3 0 0 1 0 2.8l1.8 1.9-1.4 2.4-2.5-.7a7.2 7.2 0 0 1-2.4 1L12 21.2 10.6 19a7.2 7.2 0 0 1-2.4-1l-2.5.7-1.4-2.4 1.8-1.9a7.3 7.3 0 0 1 0-2.8L4.3 9.7l1.4-2.4 2.5.7a7.2 7.2 0 0 1 2.4-1L12 2.8Z" /></svg>
);
export const BellIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>
);
export const MenuIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const FlagIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 21V4" /><path d="M5 4c4-2 7 2 11 0l2-.8V13c-4 2-7-2-11 0" /></svg>
);
export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 21h16" /></svg>
);
export const UploadIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 15V3" /><path d="m7 7 5-5 5 5" /><path d="M4 21h16" /></svg>
);
export const PrinterIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M7 8V3h10v5" /><rect x="4" y="8" width="16" height="8" rx="1.5" /><path d="M7 13h10v8H7v-8Z" /></svg>
);
export const LockIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
export const MailIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
);
export const TrophyIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" /><path d="M8 5H4.5A3.5 3.5 0 0 0 8 9.5M16 5h3.5A3.5 3.5 0 0 1 16 9.5" /><path d="M12 13v4m-4 4h8m-6.5 0v-4h5v4" /></svg>
);
export const RepeatIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M17 2.5 21 6l-4 3.5" /><path d="M21 6H8a5 5 0 0 0-5 5" /><path d="M7 21.5 3 18l4-3.5" /><path d="M3 18h13a5 5 0 0 0 5-5" /></svg>
);
export const MegaphoneIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 10v4l11 4V6L3 10Z" /><path d="M14 7.5c2.5 0 5 1.8 5 4.5s-2.5 4.5-5 4.5" /><path d="M6.5 14.8V19a1.5 1.5 0 0 0 3 0v-3" /></svg>
);
export const PlayIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M7 4.5v15l12-7.5L7 4.5Z" /></svg>
);
export const StopIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
);
export const SparkleIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></svg>
);
