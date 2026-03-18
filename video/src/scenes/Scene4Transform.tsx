import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme, syntax } from "../theme";

/** Token type for syntax highlighting */
interface Token {
  text: string;
  color: string;
}
type CodeLine = Token[];

const reactLines: CodeLine[] = [
  [
    { text: "export", color: syntax.keyword },
    { text: " ", color: syntax.plain },
    { text: "default", color: syntax.keyword },
    { text: " ", color: syntax.plain },
    { text: "function", color: syntax.keyword },
    { text: " ", color: syntax.plain },
    { text: "ResearchView", color: syntax.function },
    { text: "() {", color: syntax.plain },
  ],
  [
    { text: "  ", color: syntax.plain },
    { text: "const", color: syntax.keyword },
    { text: " [query, setQuery] = ", color: syntax.plain },
    { text: "useState", color: syntax.function },
    { text: "(", color: syntax.plain },
    { text: "''", color: syntax.string },
    { text: ")", color: syntax.plain },
  ],
  [
    { text: "  ", color: syntax.plain },
    { text: "const", color: syntax.keyword },
    { text: " { agents, status } = ", color: syntax.plain },
    { text: "useResearch", color: syntax.function },
    { text: "()", color: syntax.plain },
  ],
  [{ text: "", color: syntax.plain }],
  [
    { text: "  ", color: syntax.plain },
    { text: "return", color: syntax.keyword },
    { text: " (", color: syntax.plain },
  ],
  [
    { text: "    <", color: syntax.plain },
    { text: "div", color: syntax.tag },
    { text: " ", color: syntax.plain },
    { text: "className", color: syntax.attr },
    { text: "=", color: syntax.plain },
    { text: '"research-grid"', color: syntax.string },
    { text: ">", color: syntax.plain },
  ],
  [
    { text: "      <", color: syntax.plain },
    { text: "SearchBar", color: syntax.jsx },
    { text: " ", color: syntax.plain },
    { text: "value", color: syntax.attr },
    { text: "={query} />", color: syntax.plain },
  ],
  [
    { text: "      <", color: syntax.plain },
    { text: "AgentGrid", color: syntax.jsx },
    { text: " ", color: syntax.plain },
    { text: "agents", color: syntax.attr },
    { text: "={agents} />", color: syntax.plain },
  ],
  [
    { text: "      <", color: syntax.plain },
    { text: "ReportStream", color: syntax.jsx },
    { text: " ", color: syntax.plain },
    { text: "status", color: syntax.attr },
    { text: "={status} />", color: syntax.plain },
  ],
  [
    { text: "    </", color: syntax.plain },
    { text: "div", color: syntax.tag },
    { text: ">", color: syntax.plain },
  ],
  [{ text: "  )", color: syntax.plain }],
  [{ text: "}", color: syntax.plain }],
];

const swiftLines: CodeLine[] = [
  [
    { text: "struct", color: syntax.keyword },
    { text: " ", color: syntax.plain },
    { text: "ResearchView", color: syntax.type },
    { text: ": ", color: syntax.plain },
    { text: "View", color: syntax.type },
    { text: " {", color: syntax.plain },
  ],
  [
    { text: "  ", color: syntax.plain },
    { text: "@State", color: syntax.variable },
    { text: " ", color: syntax.plain },
    { text: "private", color: syntax.keyword },
    { text: " ", color: syntax.plain },
    { text: "var", color: syntax.keyword },
    { text: " query = ", color: syntax.plain },
    { text: '""', color: syntax.string },
  ],
  [
    { text: "  ", color: syntax.plain },
    { text: "@Observable", color: syntax.variable },
    { text: " ", color: syntax.plain },
    { text: "var", color: syntax.keyword },
    { text: " research = ", color: syntax.plain },
    { text: "ResearchModel", color: syntax.type },
    { text: "()", color: syntax.plain },
  ],
  [{ text: "", color: syntax.plain }],
  [
    { text: "  ", color: syntax.plain },
    { text: "var", color: syntax.keyword },
    { text: " body: ", color: syntax.plain },
    { text: "some", color: syntax.keyword },
    { text: " ", color: syntax.plain },
    { text: "View", color: syntax.type },
    { text: " {", color: syntax.plain },
  ],
  [
    { text: "    ", color: syntax.plain },
    { text: "VStack", color: syntax.type },
    { text: " {", color: syntax.plain },
  ],
  [
    { text: "      ", color: syntax.plain },
    { text: "SearchBar", color: syntax.type },
    { text: "(text: ", color: syntax.plain },
    { text: "$query", color: syntax.variable },
    { text: ")", color: syntax.plain },
  ],
  [
    { text: "      ", color: syntax.plain },
    { text: "AgentGridView", color: syntax.type },
    { text: "(agents: research.", color: syntax.plain },
    { text: "agents", color: syntax.plain },
    { text: ")", color: syntax.plain },
  ],
  [
    { text: "      ", color: syntax.plain },
    { text: "ReportStreamView", color: syntax.type },
    { text: "(status: research.", color: syntax.plain },
    { text: "status", color: syntax.plain },
    { text: ")", color: syntax.plain },
  ],
  [
    { text: "    }", color: syntax.plain },
  ],
  [
    { text: "  }", color: syntax.plain },
  ],
  [
    { text: "}", color: syntax.plain },
  ],
];

const MiniCodePanel: React.FC<{
  lines: CodeLine[];
  label: string;
  labelColor: string;
  dimmed?: boolean;
}> = ({ lines, label, labelColor, dimmed }) => {
  return (
    <div
      style={{
        width: 740,
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${dimmed ? "rgba(255,255,255,0.06)" : "rgba(62,207,142,0.2)"}`,
        opacity: dimmed ? 0.4 : 1,
        transition: "opacity 0.3s",
      }}
    >
      {/* Header */}
      <div
        style={{
          backgroundColor: "#1A1A22",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: labelColor,
          }}
        />
        <span
          style={{
            fontFamily: theme.fontMono,
            fontSize: 13,
            color: theme.gray,
          }}
        >
          {label}
        </span>
      </div>
      {/* Code */}
      <div
        style={{
          backgroundColor: "#0F0F16",
          padding: "20px 24px",
          fontFamily: theme.fontMono,
          fontSize: 18,
          lineHeight: "30px",
          whiteSpace: "pre",
          minHeight: 380,
        }}
      >
        {lines.map((line, i) => (
          <div key={i}>
            {line.map((tok, j) => (
              <span key={j} style={{ color: tok.color }}>
                {tok.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export const Scene4Transform: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Left panel dims after beam passes
  const leftDim = interpolate(frame, [30, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Conversion beam sweeps left to right
  const beamProgress = interpolate(frame, [20, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const beamX = interpolate(beamProgress, [0, 1], [-200, 1920 + 200]);
  const beamOpacity = beamProgress > 0 && beamProgress < 1 ? 1 : 0;

  // Right panel reveals after beam
  const rightReveal = spring({
    frame: Math.max(0, frame - 40),
    fps,
    config: { damping: 14 },
  });
  const rightOpacity = interpolate(frame, [40, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Scene fade in/out
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [130, 149], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      {/* Two code panels side by side */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          gap: 40,
          padding: "0 60px",
        }}
      >
        {/* React panel */}
        <div style={{ opacity: 1 - leftDim * 0.6 }}>
          <MiniCodePanel
            lines={reactLines}
            label="ResearchView.tsx"
            labelColor="#61AFEF"
            dimmed={leftDim > 0.5}
          />
        </div>

        {/* Arrow / connector */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg width={60} height={40} viewBox="0 0 60 40">
            <defs>
              <linearGradient id="arrowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={theme.green} />
                <stop offset="100%" stopColor={theme.orange} />
              </linearGradient>
            </defs>
            <path
              d="M5 20 L45 20 M35 10 L48 20 L35 30"
              stroke="url(#arrowGrad)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={interpolate(frame, [15, 25], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })}
            />
          </svg>
        </div>

        {/* SwiftUI panel */}
        <div
          style={{
            opacity: rightOpacity,
            transform: `scale(${rightReveal})`,
            transformOrigin: "left center",
          }}
        >
          <MiniCodePanel
            lines={swiftLines}
            label="ResearchView.swift"
            labelColor={theme.orange}
          />
        </div>
      </AbsoluteFill>

      {/* Conversion beam */}
      {beamOpacity > 0 && (
        <div
          style={{
            position: "absolute",
            left: beamX,
            top: 0,
            width: 4,
            height: 1080,
            background: `linear-gradient(180deg, transparent 0%, ${theme.green} 30%, ${theme.orange} 70%, transparent 100%)`,
            boxShadow: `0 0 40px 12px rgba(62, 207, 142, 0.4), 0 0 80px 24px rgba(240, 180, 41, 0.2)`,
            opacity: beamOpacity,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
