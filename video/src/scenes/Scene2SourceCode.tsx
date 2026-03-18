import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { theme, syntax } from "../theme";

/** A single syntax-highlighted line */
interface Token {
  text: string;
  color: string;
}

type CodeLine = Token[];

const codeLines: CodeLine[] = [
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
  [
    { text: "  )", color: syntax.plain },
  ],
  [
    { text: "}", color: syntax.plain },
  ],
];

const CodeBlock: React.FC<{ lines: CodeLine[]; revealProgress: number }> = ({
  lines,
  revealProgress,
}) => {
  const visibleLines = Math.floor(revealProgress * lines.length);

  return (
    <div
      style={{
        fontFamily: theme.fontMono,
        fontSize: 22,
        lineHeight: "36px",
        whiteSpace: "pre",
      }}
    >
      {lines.map((line, i) => {
        const lineOpacity = i < visibleLines ? 1 : 0;
        return (
          <div key={i} style={{ opacity: lineOpacity }}>
            {line.map((token, j) => (
              <span key={j} style={{ color: token.color }}>
                {token.text}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
};

export const Scene2SourceCode: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Slide the editor window in from the left
  const slideIn = spring({ frame, fps, config: { damping: 14, mass: 0.6 } });
  const editorX = interpolate(slideIn, [0, 1], [-600, 0]);

  // Reveal lines progressively
  const revealProgress = interpolate(frame, [15, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Scene opacity
  const fadeIn = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [100, 119], [1, 0], {
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
            transform: `translateX(${editorX}px)`,
            width: 900,
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: `0 0 80px rgba(62, 207, 142, 0.15)`,
            border: `1px solid rgba(62, 207, 142, 0.2)`,
          }}
        >
          {/* Title bar */}
          <div
            style={{
              backgroundColor: "#1E1E24",
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            {/* Traffic lights */}
            <div style={{ display: "flex", gap: 8 }}>
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
            </div>
            {/* File tab */}
            <div
              style={{
                marginLeft: 16,
                backgroundColor: theme.bg,
                padding: "6px 16px",
                borderRadius: 6,
                fontSize: 14,
                fontFamily: theme.fontMono,
                color: theme.grayLight,
              }}
            >
              ResearchView.tsx
            </div>
          </div>
          {/* Code body */}
          <div
            style={{
              backgroundColor: "#12121A",
              padding: "28px 32px",
              minHeight: 440,
            }}
          >
            <CodeBlock lines={codeLines} revealProgress={revealProgress} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
