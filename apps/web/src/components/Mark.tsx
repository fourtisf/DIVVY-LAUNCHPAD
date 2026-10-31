import { useId } from "react";

/** The hwai mark: a gold square-holed cash coin (brand/hwai). `variant="red"` is the red coin on the envelope. */
export function Mark({ size = 30, variant = "gold" }: { size?: number; variant?: "gold" | "red" }) {
  const id = useId();
  const stops = variant === "red" ? [["0", "#E33240"], ["1", "#8C0D17"]] : [["0", "#FFE8A8"], [".5", "#F4C24E"], ["1", "#B98A1E"]];
  const rim = variant === "red" ? "#FFE6A3" : "#5A0A0F";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {stops.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
      </defs>
      <path d="M8 50A42 42 0 1 1 92 50A42 42 0 1 1 8 50Z M38 38V62H62V38Z" fill={`url(#${id})`} fillRule="evenodd" />
      <circle cx="50" cy="50" r="34" fill="none" stroke={rim} strokeOpacity=".38" strokeWidth="2" />
      <rect x="32" y="32" width="36" height="36" fill="none" stroke={rim} strokeOpacity=".38" strokeWidth="2" />
    </svg>
  );
}
