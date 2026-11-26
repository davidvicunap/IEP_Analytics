// One small icon family (24×24 grid, 1.75 stroke, currentColor) instead of text glyphs, so
// icons render the same on every platform and inherit color and size from their context.
type IconProps = { className?: string; size?: number; title?: string };

function Svg({ className = "", size = 20, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
export const StarIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="m12 3.5 2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.75 1-5.8L3.5 9.7l5.9-.9Z"
      fill={filled ? "currentColor" : "none"}
    />
  </Svg>
);
export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Svg>
);
export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 9 7 7 7-7" />
  </Svg>
);
export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.01" />
  </Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 21.5 20h-19Z" />
    <path d="M12 10v4.5M12 17.2v.01" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);
export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);
export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const NotebookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6Z" />
    <path d="M6 3.5v17M4 8h4M4 12h4M4 16h4M10.5 8.5h5M10.5 12h5" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 7h15M10 7V5h4v2M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />
  </Svg>
);

/** Up/down triangle for price changes; the sign in the text carries the meaning too. */
export function DirectionGlyph({ up, className = "" }: { up: boolean; className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={`inline-block shrink-0 ${className}`}>
      <path d={up ? "M5 1.5 9 8H1Z" : "M5 8.5 1 2h8Z"} fill="currentColor" />
    </svg>
  );
}

/** The app mark, shared by the header and the beta gate. */
export function LogoMark({ size = 26 }: { size?: number }) {
  // Fixed brand colours (not theme tokens): ink blue and paper, the same on light and dark.
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
      <rect width="64" height="64" rx="12" fill="#22489a" />
      <path d="M14 43 L26 31 L35 38 L50 22" stroke="#faf9f6" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export const ExpandIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
export const FileTextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3.5H6.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8z" />
    <path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h7" />
  </Svg>
);
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
  </Svg>
);
export const CanvasIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="10" height="8" rx="1.5" />
    <rect x="15.5" y="3.5" width="5" height="8" rx="1.5" />
    <rect x="3.5" y="13.5" width="17" height="7" rx="1.5" />
  </Svg>
);
export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);
export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const MaximizeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
  </Svg>
);
export const RestoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />
  </Svg>
);
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
    <path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1" />
  </Svg>
);
export const FitIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
    <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
  </Svg>
);
