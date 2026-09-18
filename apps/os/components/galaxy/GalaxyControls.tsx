"use client";

import { useState } from "react";
import { ArrowUpRight, CircleHelp, Compass, Focus, Orbit, Pause, Play, X } from "lucide-react";
import type { TimeRate } from "./camera/focusStore";
import type { CameraView } from "./camera/OrbitRig";

export function GalaxyControls({ rate, setRate, drifting, setDrifting, reducedMotion, onView, functional = false, drawing = true }: {
  rate: TimeRate; setRate: (rate: TimeRate) => void;
  drifting: boolean; setDrifting: (value: boolean) => void; reducedMotion: boolean;
  onView: (view: CameraView) => void; functional?: boolean;
  /** False whenever the scene is not drawing — see `surfaceState`. */
  drawing?: boolean;
}) {
  const [guide, setGuide] = useState(false);
  const [previousRate, setPreviousRate] = useState<TimeRate>(1);
  const paused = reducedMotion || rate === 0;
  // A control that commands a scene which is not running is a lie the operator can click. When the
  // picture is gone the motion controls go with it; the view buttons stay, because they are the
  // camera the scene will use when it comes back.
  const motionDisabled = reducedMotion || !drawing;
  const selectedRate = rate === 0 ? previousRate : rate;
  return (
    <div className="galaxy-ui" data-functional={functional}>
      <header className="galaxy-heading">
        <div className="galaxy-eyebrow"><span /> ASCEND / OBSERVATORY</div>
        <h1>A universe<br />in motion<span>.</span></h1>
        <p>Follow the light. Find your perspective.</p>
      </header>

      <div className="galaxy-top-actions">
        <span className="galaxy-preview">Galaxy preview</span>
        <button className="galaxy-icon-button" aria-label="About this galaxy" aria-expanded={guide}
          aria-controls="galaxy-guide" onClick={() => setGuide(!guide)}>
          {guide ? <X size={18} /> : <CircleHelp size={18} />}
        </button>
      </div>

      {guide && <aside id="galaxy-guide" className="galaxy-guide">
        <div className="galaxy-eyebrow">A CLOSER LOOK</div>
        <h2>Light, orbit & gravity.</h2>
        <p>A warm stellar center gives way to cool spiral arms and rose-colored clouds. At the heart, light bends around a dark core.</p>
        <p>Drag to orbit. Scroll or pinch to explore. Use Overview to find your way back.</p>
        <p className="galaxy-guide-note">{functional ? "Select a client sun to reveal its projects and satellites. Use the directory to search every record, or Escape to return one level." : "This scene is a visual preview. Client and project navigation is still being built."}</p>
      </aside>}

      <section className="galaxy-core-caption" aria-label="Galactic center">
        <div className="galaxy-eyebrow">01 / THE CENTER</div>
        <h2>Everything begins<br />with a little gravity.</h2>
        <button className="galaxy-text-button" onClick={() => onView("core")}>Explore the core <ArrowUpRight size={16} /></button>
      </section>

      <footer className="galaxy-bottom">
        <div className="galaxy-legend" aria-label="Scene colors">
          <span><i className="galaxy-dot-warm" /> Stellar core</span>
          <span><i className="galaxy-dot-cool" /> Spiral arms</span>
          <span><i className="galaxy-dot-rose" /> Emission clouds</span>
        </div>
        <div className="galaxy-toolbar" role="toolbar" aria-label="Galaxy controls">
          <button onClick={() => onView("galaxy")}><Focus size={17} /><span>Overview</span></button>
          <button onClick={() => onView("core")}><Orbit size={17} /><span>Core</span></button>
          <span className="galaxy-divider" />
          <button aria-label={paused ? "Play orbital motion" : "Pause orbital motion"}
            disabled={motionDisabled} onClick={() => {
              if (rate === 0) setRate(previousRate);
              else { setPreviousRate(rate); setRate(0); }
            }}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
          <button aria-label="Accelerate orbital motion" aria-pressed={selectedRate === 24}
            disabled={motionDisabled} onClick={() => {
              const next = selectedRate === 24 ? 1 : 24;
              setPreviousRate(next);
              if (rate !== 0) setRate(next);
            }}>{selectedRate === 24 ? "24×" : "1×"}</button>
          <span className="galaxy-divider" />
          <button aria-label="Auto orbit" aria-pressed={drifting} disabled={motionDisabled} onClick={() => setDrifting(!drifting)}>
            <Compass size={17} /><span>Auto orbit</span>
          </button>
        </div>
        <div className="galaxy-status" role="status">
          <span className={paused || !drawing ? "" : "galaxy-status-live"} />
          {!drawing ? "Scene unavailable" : reducedMotion ? "Reduced motion" : paused ? "Time paused" : "In motion"}
        </div>
      </footer>
    </div>
  );
}
