import BackgroundParallax from "../animation/BackgroundParallax";

type ParallaxDivider2Props = {
  src: string;
  projectKey: string;
};

export default function ParallaxDivider2({ src, projectKey }: ParallaxDivider2Props) {
  return (
    <div className="mxd-section">
      <div className="mxd-container">
        <div className="mxd-divider loading__fade">
          <BackgroundParallax
            key={projectKey}
            image={src}
            scale={1.5}
            className="mxd-divider__image"
          />
        </div>
      </div>
    </div>
  );
}