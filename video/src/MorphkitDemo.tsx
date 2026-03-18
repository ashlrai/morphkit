import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { theme } from "./theme";
import { Scene1Logo } from "./scenes/Scene1Logo";
import { Scene2SourceCode } from "./scenes/Scene2SourceCode";
import { Scene3Terminal } from "./scenes/Scene3Terminal";
import { Scene4Transform } from "./scenes/Scene4Transform";
import { Scene5Stats } from "./scenes/Scene5Stats";
import { Scene6CTA } from "./scenes/Scene6CTA";

export const MorphkitDemo: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.bg,
        fontFamily: theme.fontSans,
      }}
    >
      {/* Scene 1: Logo + Tagline (0–3s → frames 0–89) */}
      <Sequence from={0} durationInFrames={90}>
        <Scene1Logo />
      </Sequence>

      {/* Scene 2: Source Code Reveal (3–7s → frames 90–209) */}
      <Sequence from={90} durationInFrames={120}>
        <Scene2SourceCode />
      </Sequence>

      {/* Scene 3: Terminal Command (7–9s → frames 210–269) */}
      <Sequence from={210} durationInFrames={60}>
        <Scene3Terminal />
      </Sequence>

      {/* Scene 4: Code Transformation (9–14s → frames 270–419) */}
      <Sequence from={270} durationInFrames={150}>
        <Scene4Transform />
      </Sequence>

      {/* Scene 5: Stats + iPhone Mockup (14–17s → frames 420–509) */}
      <Sequence from={420} durationInFrames={90}>
        <Scene5Stats />
      </Sequence>

      {/* Scene 6: CTA (17–20s → frames 510–599) */}
      <Sequence from={510} durationInFrames={90}>
        <Scene6CTA />
      </Sequence>
    </AbsoluteFill>
  );
};
