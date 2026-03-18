import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../theme";

const stats = [
  { label: "24 components", target: "SwiftUI", delay: 0 },
  { label: "6 routes", target: "NavigationStack", delay: 8 },
  { label: "8 API endpoints", target: "URLSession", delay: 16 },
];

/** CSS-only iPhone frame mockup */
const IPhoneMockup: React.FC<{ opacity: number; x: number }> = ({
  opacity,
  x,
}) => {
  return (
    <div
      style={{
        opacity,
        transform: `translateX(${x}px)`,
        width: 280,
        height: 560,
        borderRadius: 40,
        border: `3px solid #333`,
        backgroundColor: "#111116",
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 0 60px rgba(62, 207, 142, 0.1)",
      }}
    >
      {/* Notch / Dynamic Island */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: "50%",
          transform: "translateX(-50%)",
          width: 100,
          height: 28,
          borderRadius: 14,
          backgroundColor: "#000",
          zIndex: 2,
        }}
      />
      {/* Screen content — a stylized app UI */}
      <div style={{ padding: "52px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Search bar */}
        <div
          style={{
            height: 36,
            borderRadius: 10,
            backgroundColor: "#1C1C24",
            border: "1px solid #2A2A36",
          }}
        />
        {/* Agent cards grid */}
        <div style={{ display: "flex", gap: 8 }}>
          <div
            style={{
              flex: 1,
              height: 100,
              borderRadius: 12,
              background: `linear-gradient(135deg, rgba(62,207,142,0.15), rgba(62,207,142,0.05))`,
              border: "1px solid rgba(62,207,142,0.2)",
            }}
          />
          <div
            style={{
              flex: 1,
              height: 100,
              borderRadius: 12,
              background: `linear-gradient(135deg, rgba(240,180,41,0.15), rgba(240,180,41,0.05))`,
              border: "1px solid rgba(240,180,41,0.2)",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div
            style={{
              flex: 1,
              height: 100,
              borderRadius: 12,
              background: `linear-gradient(135deg, rgba(97,175,239,0.15), rgba(97,175,239,0.05))`,
              border: "1px solid rgba(97,175,239,0.2)",
            }}
          />
          <div
            style={{
              flex: 1,
              height: 100,
              borderRadius: 12,
              background: `linear-gradient(135deg, rgba(198,120,221,0.15), rgba(198,120,221,0.05))`,
              border: "1px solid rgba(198,120,221,0.2)",
            }}
          />
        </div>
        {/* Report stream placeholder */}
        <div
          style={{
            height: 140,
            borderRadius: 12,
            backgroundColor: "#14141C",
            border: "1px solid #22222E",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: "#1E1E28",
                width: `${85 - i * 12}%`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export const Scene5Stats: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Scene fade
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [75, 89], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // iPhone slides in from right
  const phoneSlide = spring({
    frame: Math.max(0, frame - 25),
    fps,
    config: { damping: 14 },
  });
  const phoneX = interpolate(phoneSlide, [0, 1], [300, 0]);
  const phoneOpacity = interpolate(frame, [25, 35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          gap: 120,
          padding: "0 120px",
        }}
      >
        {/* Stats column */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 32,
          }}
        >
          {stats.map((stat, i) => {
            const progress = spring({
              frame: Math.max(0, frame - stat.delay),
              fps,
              config: { damping: 12, mass: 0.5 },
            });
            const y = interpolate(progress, [0, 1], [30, 0]);
            const opacity = interpolate(
              frame,
              [stat.delay, stat.delay + 10],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            );

            return (
              <div
                key={i}
                style={{
                  opacity,
                  transform: `translateY(${y}px)`,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                {/* Stat number/source */}
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    fontFamily: theme.fontSans,
                    color: theme.white,
                    minWidth: 240,
                    textAlign: "right",
                  }}
                >
                  {stat.label}
                </div>
                {/* Arrow */}
                <svg width={32} height={20} viewBox="0 0 32 20">
                  <defs>
                    <linearGradient
                      id={`statArrow${i}`}
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="0%"
                    >
                      <stop offset="0%" stopColor={theme.green} />
                      <stop offset="100%" stopColor={theme.orange} />
                    </linearGradient>
                  </defs>
                  <path
                    d="M2 10 L24 10 M18 4 L26 10 L18 16"
                    stroke={`url(#statArrow${i})`}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
                {/* Target */}
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 600,
                    fontFamily: theme.fontMono,
                    background: theme.gradient,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {stat.target}
                </div>
              </div>
            );
          })}
        </div>

        {/* iPhone mockup */}
        <IPhoneMockup opacity={phoneOpacity} x={phoneX} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
