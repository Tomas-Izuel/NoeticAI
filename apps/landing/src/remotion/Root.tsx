import { Composition } from "remotion";
import { FlowAnimation } from "../animations/FlowAnimation/FlowAnimation";
import { TOTAL_FRAMES } from "../animations/FlowAnimation/FlowAnimation";

export const RemotionRoot = () => {
  return (
    <Composition
      id="FlowAnimation"
      component={FlowAnimation}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1280}
      height={720}
    />
  );
};
