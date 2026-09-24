import { cn } from "@/components/lib/utils.js";

export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="100"
      height="100"
      fill="none"
      viewBox="0 0 256 256"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M83.2 67.84 128 116.48 172.8 67.84"
        stroke="currentColor"
        strokeWidth="29.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M128 116.48V185.6"
        stroke="currentColor"
        strokeWidth="29.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return (
    <svg
      width="244"
      height="54"
      viewBox="0 0 244 54"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <text
        x="0"
        y="38"
        fill="currentColor"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="38"
        fontWeight="600"
        letterSpacing="-1"
      >
        Yoyo Code
      </text>
    </svg>
  );
}
