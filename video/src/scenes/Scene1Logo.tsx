import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../theme";

/** Animated grid background with faint lines */
const GridBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 0.12], {
    extrapolateRight: "clamp",
  });

  const lines: React.ReactNode[] = [];
  const spacing = 60;

  // Vertical lines
  for (let x = 0; x <= 1920; x += spacing) {
    lines.push(
      <line
        key={`v-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={1080}
        stroke={theme.green}
        strokeWidth={0.5}
      />
    );
  }
  // Horizontal lines
  for (let y = 0; y <= 1080; y += spacing) {
    lines.push(
      <line
        key={`h-${y}`}
        x1={0}
        y1={y}
        x2={1920}
        y2={y}
        stroke={theme.green}
        strokeWidth={0.5}
      />
    );
  }

  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width={1920} height={1080}>
        {lines}
      </svg>
    </AbsoluteFill>
  );
};

/** Real Morphkit logo mark */
const MorphkitLogo: React.FC<{ size: number }> = ({ size }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
    >
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={theme.green} />
          <stop offset="100%" stopColor={theme.orange} />
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="26" fill="#09090b" />
      <rect x="1" y="1" width="118" height="118" rx="25" fill="none" stroke="url(#logoGrad)" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M30 90V42l24 28" stroke="url(#logoGrad)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M90 90V42L66 70" stroke="url(#logoGrad)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M54 70L60 38L66 70" stroke="url(#logoGrad)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M78 32l8-1-1 8" stroke={theme.orange} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />
    </svg>
  );
};

export const Scene1Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo fade + scale in
  const logoScale = spring({ frame, fps, config: { damping: 12, mass: 0.8 } });
  const logoOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Tagline slides up
  const taglineProgress = spring({
    frame: frame - 15,
    fps,
    config: { damping: 14 },
  });
  const taglineY = interpolate(taglineProgress, [0, 1], [40, 0]);
  const taglineOpacity = interpolate(frame, [15, 35], [0, 1], {
    extrapolateRight: "clamp",
  });

  // "morphkit" text under logo
  const nameOpacity = interpolate(frame, [10, 25], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Fade out at end of scene
  const sceneOpacity = interpolate(frame, [70, 89], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      <GridBackground />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Logo */}
        <div
          style={{
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
          }}
        >
          <MorphkitLogo size={180} />
        </div>

        {/* Brand name */}
        <div
          style={{
            opacity: nameOpacity,
            fontSize: 64,
            fontWeight: 700,
            fontFamily: theme.fontSans,
            background: theme.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.02em",
          }}
        >
          morphkit
        </div>

        {/* Tagline */}
        <div
          style={{
            opacity: taglineOpacity,
            transform: `translateY(${taglineY}px)`,
            fontSize: 32,
            fontWeight: 400,
            color: theme.grayLight,
            fontFamily: theme.fontSans,
            letterSpacing: "0.01em",
          }}
        >
          React → Native iOS. In seconds.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
