import type { CSSProperties, FC, ReactNode } from "react";

interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
  className?: string;
  title?: string;
}

export const Icon: FC<IconProps> = ({ name, size = 14, stroke = 1.6, ...rest }) => {
  const wrap = (paths: ReactNode) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths}
    </svg>
  );

  switch (name) {
    case "book":
      return wrap(
        <>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </>,
      );
    case "link":
      return wrap(
        <>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </>,
      );
    case "plus":
      return wrap(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>);
    case "search":
      return wrap(<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>);
    case "chev-r":
      return wrap(<polyline points="9 6 15 12 9 18" />);
    case "x":
      return wrap(<><path d="M18 6L6 18M6 6l12 12" /></>);
    case "info":
      return wrap(<><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16v.01" /></>);
    case "trash":
      return wrap(
        <>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </>,
      );
    case "sync":
      return wrap(<><path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" /></>);
    case "upload":
      return wrap(
        <>
          <polyline points="16 16 12 12 8 16" />
          <line x1="12" y1="12" x2="12" y2="21" />
          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
        </>,
      );
    default:
      return wrap(<circle cx="12" cy="12" r="9" />);
  }
};
