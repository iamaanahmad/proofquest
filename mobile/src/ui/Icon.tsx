import React from "react";
import Svg, { Path, Circle, Rect, Line, Polyline } from "react-native-svg";
import { color } from "../theme/tokens";

export type IconName =
  | "back"
  | "plus"
  | "power"
  | "pin"
  | "camera"
  | "shield-check"
  | "clock"
  | "wallet"
  | "coin"
  | "alert"
  | "check"
  | "close"
  | "chevron-right"
  | "link"
  | "doc"
  | "search"
  | "refresh"
  | "lock";

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * In-house SVG icon set. Stroke-based, consistent 2px weight on a 24-grid, so
 * every glyph reads as part of one family. Only the icons the app actually uses
 * are included — no icon-font bloat, no emoji-as-icons.
 */
export default function Icon({ name, size = 22, color: c = color.textPrimary, strokeWidth = 2 }: Props) {
  const common = {
    stroke: c,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {renderPaths(name, c, common)}
    </Svg>
  );
}

function renderPaths(
  name: IconName,
  c: string,
  s: { stroke: string; strokeWidth: number; strokeLinecap: "round"; strokeLinejoin: "round"; fill: string }
) {
  switch (name) {
    case "back":
      return <Polyline points="15 18 9 12 15 6" {...s} />;
    case "chevron-right":
      return <Polyline points="9 6 15 12 9 18" {...s} />;
    case "plus":
      return (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" {...s} />
          <Line x1="5" y1="12" x2="19" y2="12" {...s} />
        </>
      );
    case "power":
      return (
        <>
          <Path d="M18.36 6.64a9 9 0 1 1-12.73 0" {...s} />
          <Line x1="12" y1="2" x2="12" y2="12" {...s} />
        </>
      );
    case "pin":
      return (
        <>
          <Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" {...s} />
          <Circle cx="12" cy="10" r="3" {...s} />
        </>
      );
    case "camera":
      return (
        <>
          <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" {...s} />
          <Circle cx="12" cy="13" r="4" {...s} />
        </>
      );
    case "shield-check":
      return (
        <>
          <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" {...s} />
          <Polyline points="9 12 11 14 15 10" {...s} />
        </>
      );
    case "clock":
      return (
        <>
          <Circle cx="12" cy="12" r="9" {...s} />
          <Polyline points="12 7 12 12 15 14" {...s} />
        </>
      );
    case "wallet":
      return (
        <>
          <Path d="M20 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6" {...s} />
          <Circle cx="16.5" cy="12.5" r="1.2" fill={c} stroke="none" />
        </>
      );
    case "coin":
      return (
        <>
          <Circle cx="12" cy="12" r="9" {...s} />
          <Path d="M14.5 9.5a2.5 2 0 0 0-2.5-1.5c-1.4 0-2.5.7-2.5 1.8 0 2.6 5 1.4 5 4 0 1.2-1.1 1.9-2.5 1.9a2.6 2 0 0 1-2.6-1.6" {...s} />
          <Line x1="12" y1="6.5" x2="12" y2="17.5" {...s} />
        </>
      );
    case "alert":
      return (
        <>
          <Circle cx="12" cy="12" r="9" {...s} />
          <Line x1="12" y1="8" x2="12" y2="13" {...s} />
          <Circle cx="12" cy="16.5" r="0.6" fill={c} stroke="none" />
        </>
      );
    case "check":
      return <Polyline points="5 12 10 17 19 7" {...s} />;
    case "close":
      return (
        <>
          <Line x1="6" y1="6" x2="18" y2="18" {...s} />
          <Line x1="18" y1="6" x2="6" y2="18" {...s} />
        </>
      );
    case "link":
      return (
        <>
          <Path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" {...s} />
          <Path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" {...s} />
        </>
      );
    case "doc":
      return (
        <>
          <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" {...s} />
          <Polyline points="14 3 14 8 19 8" {...s} />
        </>
      );
    case "search":
      return (
        <>
          <Circle cx="11" cy="11" r="7" {...s} />
          <Line x1="21" y1="21" x2="16.65" y2="16.65" {...s} />
        </>
      );
    case "refresh":
      return (
        <>
          <Polyline points="21 4 21 10 15 10" {...s} />
          <Path d="M20 14a8 8 0 1 1-2-7l3 3" {...s} />
        </>
      );
    case "lock":
      return (
        <>
          <Rect x="4.5" y="10.5" width="15" height="10" rx="2" {...s} />
          <Path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" {...s} />
        </>
      );
    default:
      return null;
  }
}
