import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../theme";

export const Scene6CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // CTA text fade in
  const ctaProgress = spring({
    frame: frame - 5,
    fps,
    config: { damping: 14 },
  });
  const ctaOpacity = interpolate(frame, [5, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ctaScale = interpolate(ctaProgress, [0, 1], [0.9, 1]);

  // URL fade in
  const urlOpacity = interpolate(frame, [20, 35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Pulsing green glow
  const pulsePhase = Math.sin((frame / fps) * Math.PI * 2) * 0.5 + 0.5;
  const glowIntensity = interpolate(pulsePhase, [0, 1], [0.15, 0.4]);

  // Scene fade in (everything else has faded by now)
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      {/* Radial glow behind CTA */}
      <AbsoluteFill
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 800,
            height: 400,
            borderRadius: "50%",
            background: `radial-gradient(ellipse, rgba(62, 207, 142, ${glowIntensity}) 0%, transparent 70%)`,
            filter: "blur(60px)",
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 28,
        }}
      >
        {/* CTA text */}
        <div
          style={{
            opacity: ctaOpacity,
            transform: `scale(${ctaScale})`,
            fontSize: 64,
            fontWeight: 800,
            fontFamily: theme.fontSans,
            background: theme.gradient,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.02em",
            textAlign: "center",
          }}
        >
          Try Morphkit Free
        </div>

        {/* URL */}
        <div
          style={{
            opacity: urlOpacity,
            fontSize: 30,
            fontWeight: 500,
            fontFamily: theme.fontMono,
            color: theme.grayLight,
            letterSpacing: "0.02em",
          }}
        >
          morphkit.dev
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
