import React from "react";
import { Composition } from "remotion";
import { MorphkitDemo } from "./MorphkitDemo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MorphkitDemo"
      component={MorphkitDemo}
      durationInFrames={600} // 20s at 30fps
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
