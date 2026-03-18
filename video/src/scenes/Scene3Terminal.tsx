import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme } from "../theme";

const COMMAND = "$ npx morphkit generate ./probe-web --output ./probe-ios";

const statusItems = [
  { text: "Analyzing...", delay: 35 },
  { text: "Found 24 components", delay: 45 },
];

export const Scene3Terminal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Terminal slides up from bottom
  const slideUp = spring({ frame, fps, config: { damping: 14, mass: 0.5 } });
  const terminalY = interpolate(slideUp, [0, 1], [300, 0]);

  // Type out command character by character
  const typedLength = Math.min(
    Math.floor(interpolate(frame, [10, 40], [0, COMMAND.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })),
    COMMAND.length
  );
  const typedCommand = COMMAND.slice(0, typedLength);
  const showCursor = frame % 16 < 10 && typedLength < COMMAND.length;

  // Scene opacity
  const fadeIn = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [50, 59], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          display: "flex",
        }}
      >
        <div
          style={{
            transform: `translateY(${terminalY}px)`,
            width: 880,
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 0 60px rgba(62, 207, 142, 0.12)",
            border: `1px solid rgba(62, 207, 142, 0.25)`,
          }}
        >
          {/* Title bar */}
          <div
            style={{
              backgroundColor: "#1E1E24",
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#FF5F57",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#FEBC2E",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                backgroundColor: "#28C840",
              }}
            />
            <div
              style={{
                marginLeft: 12,
                fontSize: 14,
                color: theme.gray,
                fontFamily: theme.fontMono,
              }}
            >
              Terminal
            </div>
          </div>

          {/* Terminal body */}
          <div
            style={{
              backgroundColor: "#0D0D12",
              padding: "28px 32px",
              minHeight: 200,
              fontFamily: theme.fontMono,
              fontSize: 20,
              lineHeight: "36px",
            }}
          >
            {/* Command line */}
            <div>
              <span style={{ color: theme.green }}>{typedCommand}</span>
              {showCursor && (
                <span
                  style={{
                    color: theme.green,
                    opacity: 0.8,
                  }}
                >
                  █
                </span>
              )}
            </div>

            {/* Status items with checkmarks */}
            {statusItems.map((item, i) => {
              const itemOpacity = interpolate(
                frame,
                [item.delay, item.delay + 6],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );
              const itemScale = spring({
                frame: Math.max(0, frame - item.delay),
                fps,
                config: { damping: 10 },
              });

              return (
                <div
                  key={i}
                  style={{
                    opacity: itemOpacity,
                    transform: `scale(${itemScale})`,
                    transformOrigin: "left center",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 4,
                  }}
                >
                  <span style={{ color: theme.green, fontSize: 18 }}>✓</span>
                  <span style={{ color: theme.grayLight }}>{item.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
