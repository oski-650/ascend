"use client";

// components/galaxy/GalaxyScene3D — the living Galaxy.
//
// Suns carry their systems around the Ascend Core, planets travel their suns, moons travel their
// planets. Every body is a point of light against a spiral dust field, and the light — not the
// geometry — is what the eye reads.
//
// IT DECIDES NOTHING. Every position, radius, colour, role, orbital plane and orbital rate arrived
// as a value from `celestial.toCelestialModel`, a pure function this component maps over. That split
// is load-bearing rather than tidy: WebGL cannot run in the test environment, so anything decided
// inside `<Canvas>` is untestable, while everything decided in `celestial.ts` is provable in plain
// Node at full strength. The same arrangement `scene.ts` has with the 2D painter.
//
// ─── MOTION IS A TRANSFORM, NEVER A SECOND ANSWER ──────────────────────────────────────────────
//
// This is the rule that matters most here, and it is the one a moving picture makes easy to break.
//
// **Nothing in this file computes, writes back, or stores a position.** No coordinate is authored.
// What moves is a `<group>`: the layout handed down each body's rest position within its own orbital
// plane, and advancing the orbit is one rotation of that plane —
//
//     world = anchor + rotateX(tilt) . rotateZ(t * speed) . (planeX, planeY, 0)
//
// — composed by nesting three groups and letting three.js multiply the matrices. At `t = 0` the
// result is bit-for-bit the absolute position GalaxyLayout produced. Children sit inside their
// parent's frame, so a moon rides its planet and a planet rides its sun for free, with no per-body
// arithmetic anywhere.
//
// The consequence worth stating plainly: **GalaxyLayout is still the only authority on where an
// object is.** Turn the motion off and the frame is exactly the arrangement it computed. F65 keeps
// this honest by banning trigonometry and orbital field names in this directory outright — if a
// future hand needs `cos(orbitPhase)` here, the rule goes red rather than the picture quietly
// drifting away from the model while every test still passes.
//
// ─── THE FRAME LOOP RUNS, AND THAT IS A REVERSAL ───────────────────────────────────────────────
//
// Slice 7 established a zero-idle-frame guarantee and Slice 15 enforced `frameloop="demand"`. A
// galaxy that moves cannot keep it, and pretending otherwise by animating on a timer would be the
// same cost wearing a worse mechanism. So the loop is continuous BY DECISION, and the decision has
// a limit attached: `prefers-reduced-motion` returns the surface to `demand`, where an untouched
// Galaxy still renders nothing at all and every body sits at its layout position. The guarantee did
// not disappear; it became a mode, and the operator chooses it.
//
// ─── THERE IS NO BACKDROP, AND THAT WAS A DECISION ─────────────────────────────────────────────
//
// A decorative field of dust and far stars lived here — five thousand motes on a warm-to-cool ramp,
// deterministic, meaningless by construction. It looked good in isolation and it GOT IN THE WAY: a
// viewer cannot tell a decorative dot from a business object by looking, and once the prospect
// import put three thousand real bodies on screen there were two indistinguishable populations, one
// of which meant nothing.
//
// So every point of light in this scene is now an object somebody can select, follow and open. The
// only things drawn that are not business objects are the core marker and the lattice, and both are
// obviously not bodies. If a backdrop ever comes back it has to earn its place against that.

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { Canvas, useThree, useFrame, extend, type ThreeEvent } from "@react-three/fiber";
import {
  Bloom, BrightnessContrast, EffectComposer, HueSaturation, SMAA, Vignette,
} from "@react-three/postprocessing";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SEMANTIC } from "@/graph-view/taxonomy";
import { SurfaceBoundary } from "./SurfaceBoundary";
import { toCelestialModel, type CelestialBody, type CelestialModel } from "./celestial";
import type { Scene } from "./scene";

extend({ OrbitControls });

declare module "@react-three/fiber" {
  interface ThreeElements {
    orbitControls: { args?: unknown[]; enableDamping?: boolean; makeDefault?: boolean };
  }
}

/**
 * How far the camera sits back from the framed radius. A framing constant, not a business value.
 *
 * It has to satisfy actual trigonometry, and at 2.15 it did not. The vertical half-height a
 * perspective camera sees is `distance x tan(fov/2)` — at 2.15 x WORLD_RADIUS with a 48 degree fov
 * that is 2105 units against a galaxy of radius 2200, so the outermost bodies were framed just
 * OFF SCREEN. "Fit" that does not fit is worse than no fit: it looks like the bodies are missing.
 *
 * 2.7 clears the rim with room to spare (half-height 2640 against 2200).
 */
const FIT_DISTANCE = 2.7;
/**
 * How far a focused body is viewed from, as a multiple of its own VISIBLE EXTENT.
 *
 * Extent, not radius. A body's glow reaches several times further than its surface, so a distance
 * derived from the radius alone put the camera inside the halo — the object was centred and
 * followed correctly, and the frame was a flat wash of its colour with the sphere lost in it.
 */
const FOCUS_DISTANCE = 3.0;

/**
 * The radius this surface draws every galaxy at, whatever size the layout produced.
 *
 * ─── ONE UNIFORM SCALE, AND IT REMOVES A WHOLE CLASS OF BUG ────────────────────────────────────
 *
 * The root disc grows as √N, so a graph of 83 objects spans about 7,600 world units and one of
 * 3,226 spans about 32,000 — and a CSV import of prospects will move it again. Every constant that
 * touched world distance was therefore a guess about how big the business is: the camera's clipping
 * planes, its zoom limits, the fog density, the size of a dust mote. Each of those guesses was
 * wrong at 3,226 objects, and the way it showed up was a black screen with nothing logged.
 *
 * So the whole galaxy is scaled into a FIXED world before anything looks at it. Uniform scale about
 * the origin changes no relative position, no proportion and no clearance — it is the same picture,
 * measured in units this file can hold constants about. Everything downstream then works at any
 * size, including sizes nobody has imported yet.
 */
const WORLD_RADIUS = 2200;



/**
 * Every distance constant this file needs, all of them stated against WORLD_RADIUS.
 *
 * They can be constants BECAUSE of the normalisation: the galaxy is always this big by the time
 * anything looks at it, whether the graph holds thirty objects or thirty thousand. Before that,
 * each of these was derived per-render from the scene extent — which meant writing to the camera
 * inside an effect, which is a mutation of a value React owns, and the linter was right to refuse
 * it. Fixing the scale removed the need for the mutation rather than working around it.
 */
const CAMERA_NEAR = WORLD_RADIUS / 400;
const CAMERA_FAR = WORLD_RADIUS * 40;
// Close enough to inspect one body's surface. It was 0.05 of the world radius — a hundred and ten
// units — which is further away than some bodies are wide, so the camera could never reach them.
const MIN_ORBIT_DISTANCE = WORLD_RADIUS * 0.0012;
/** Closest a focus jump will ever place the camera, so a speck does not put it inside the field. */
const MIN_FOCUS_DISTANCE = WORLD_RADIUS * 0.0025;

/**
 * How fast the camera closes on a newly focused body, per second, as an exponential rate.
 *
 * Frame-rate independent: the per-frame factor is `1 - e^(-λ·dt)`, so the glide takes the same
 * WALL TIME at 30fps and at 120. A plain `lerp(a, b, 0.1)` would be twice as fast on a 120Hz
 * display, which is the usual reason camera work feels different on different machines.
 *
 * The glide exists only for the approach. Once the camera is essentially there it hands over to the
 * rigid lock, so orbiting and dollying stay exact rather than fighting a spring.
 */
const FOCUS_GLIDE = 3.4;

/**
 * How long the approach is allowed to take, in seconds, after which the rigid lock takes over.
 *
 * ─── WHY THIS IS A DURATION AND NOT A DISTANCE ─────────────────────────────────────────────────
 *
 * It was "end the glide once the camera is within a fraction of its goal", which is the obvious
 * test and is wrong here, because THE GOAL IS ATTACHED TO A MOVING OBJECT. A damped approach has
 * permanent steady-state lag against a moving target, so the remaining distance never falls below
 * the threshold, the glide never ends, and the lock never becomes rigid.
 *
 * The visible result is a body that sits progressively further off-centre the faster it orbits —
 * and inner bodies orbit several times faster than outer ones, which is why it looked intermittent
 * rather than broken. Measured: a focused client had drifted to the edge of the frame after a
 * minute, still nominally "locked".
 *
 * A duration cannot be outrun. The approach gets its second, then the camera is placed exactly.
 */
const GLIDE_SECONDS = 0.9;
const MAX_ORBIT_DISTANCE = WORLD_RADIUS * 12;
const FIT_TARGET = new THREE.Vector3(0, 0, 0);
/** Sphere tessellation. Low on purpose: these are points of light, not surfaces to be admired. */
const SPHERE_SEGMENTS = 24;

// ── SHARED SOFT DOT ────────────────────────────────────────────────────────────────────────────

/**
 * The soft dot every halo and every corona layer is drawn with. Computed, not rasterised.
 *
 * ─── WHY THIS IS A DataTexture AND NOT A CANVAS GRADIENT ───────────────────────────────────────
 *
 * It was a 64x64 `<canvas>` with `createRadialGradient`. That is the obvious way to make a soft dot
 * and it produced a bug that took four rounds to find, because it appears in SAFARI and not in
 * Chrome:
 *
 *   Safari DITHERS canvas gradients — it adds per-pixel colour noise to hide banding. At 64 pixels
 *   across, magnified ten to twenty times to cover a halo, every one of those dithered pixels
 *   becomes a large coloured square. The result is dozens of red, green and blue SPECKS arranged in
 *   concentric rings around every glowing body, following the gradient's contours. They look
 *   exactly like a decorative particle field, they are not clickable, and no amount of removing
 *   real objects makes them go away — because they are not objects, they are the texture.
 *
 * So the falloff is computed here, byte by byte, into a `DataTexture`. No canvas, no browser
 * rasteriser, no dithering, identical on every engine. It is also four times the resolution, so
 * magnification is far less brutal, and it costs one 256x256 buffer built once.
 *
 * The curve is a smooth quartic — full brightness through the middle, fading to nothing at the rim
 * — which is what makes a body drawn at one pixel still read as a point of light rather than fog.
 */
function softDotTexture(): THREE.Texture {
  const SIZE = 256;
  const HALF = SIZE / 2;
  const data = new Uint8Array(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Distance from the centre, normalised so 1 is the edge of the sprite.
      const dx = (x + 0.5 - HALF) / HALF;
      const dy = (y + 0.5 - HALF) / HALF;
      const d = Math.sqrt(dx * dx + dy * dy);
      // Hold near-full brightness through the core, then fall away smoothly to zero at the rim.
      const t = Math.max(0, 1 - d);
      const alpha = d >= 1 ? 0 : Math.min(1, t * t * (3 - 2 * t) * 1.35);
      const i = (y * SIZE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// ── THE OBJECT REGISTRY ────────────────────────────────────────────────────────────────────────

/**
 * Where each body's three.js object currently is.
 *
 * The lattice needs both endpoints of a link in WORLD space, and once the systems are turning those
 * endpoints live in different moving frames. Asking three.js where it just put an object is not a
 * second placement authority — it is reading the result of the only one. Nothing is written back
 * into the model, and no coordinate produced here outlives the frame that drew it.
 */
const Registry = createContext<Map<string, THREE.Object3D> | null>(null);

// ── ONE BODY ───────────────────────────────────────────────────────────────────────────────────

/**
 * One business object: a small luminous core, a soft halo, and an invisible target big enough to hit.
 *
 * The core is deliberately tiny. A luminous body reads by its glow — the bloom pass downstream turns
 * a bright four-unit sphere into something that dominates its neighbourhood — so the geometry can
 * stay small enough that two bodies sharing a ring never interpenetrate. Matte spheres large enough
 * to see were the previous attempt, and they collided by 103 world units.
 */
function Body({
  body, dot, scale, floored, selected, hovered, dimmed, onSelect, onHover,
}: {
  body: CelestialBody;
  dot: THREE.Texture;
  /** The normalising scale, so the body's own SCREEN floor can be expressed in layout units. */
  scale: number;
  /** Whether the screen-size floor applies. False in a scoped view — see `haloSize` below. */
  floored: boolean;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const registry = useContext(Registry);
  const anchor = useRef<THREE.Group>(null);

  useEffect(() => {
    const node = anchor.current;
    if (!registry || !node) return;
    registry.set(body.id, node);
    return () => { registry.delete(body.id); };
  }, [registry, body.id]);

  // Emissive strength is a presentation value the model computed; interaction only modulates it.
  // Multiplying the colour past 1 is what carries a body over the bloom threshold — the reason
  // `toneMapped` is off here, and the only reason these read as light rather than as paint.
  // ─── EVERY BODY IS A SOLID, SHADED SPHERE ───────────────────────────────────────────────────
  //
  // These were tiny unlit discs wearing halos six to sixteen times their own radius, so what the eye
  // actually saw was the halo — a soft blob, not an object. Bodies are now large enough to have a
  // silhouette, tessellated finely enough to have a round one, and shaded by the light at the centre
  // of the galaxy so they have a terminator. A lit side and a dark side is the entire difference
  // between a sphere and a circle.
  //
  // The halo survives as a tight CORONA rather than a cloud, and it earns its place twice: it is the
  // glow, and it is the hit target, with a floor that keeps the smallest bodies clickable when the
  // galaxy is scaled down to fit.
  //
  // `body.lit` decides the BALANCE, not whether the material is lit — everything is now. A star is
  // mostly its own light with a little shading; a planet is mostly shading with a little glow.
  const attention = selected ? 1.9 : hovered ? 1.5 : dimmed ? 0.28 : 1;
  // ─── A SELECTED BODY'S GLOW COMES DOWN, IT DOES NOT GO UP ───────────────────────────────────
  //
  // Selection used to brighten and enlarge the halo, which is right at a distance and wrong once
  // selection also flies the camera to the object: the glow is 2.7x the sphere, so at any framing
  // where the sphere reads well the halo covers the frame — and additive blending turns that into a
  // flat wash in the body's own colour. The selection is announced by the camera being THERE, by
  // the label, and by the scoped list; the halo does not need to shout as well.
  const haloAttention = selected ? 0.4 : hovered ? 1.5 : dimmed ? 0.28 : 1;
  const emissive = body.emissiveStrength * (body.lit ? 0.12 : 0.34) * attention;
  // Enough that a body reads from across the galaxy. The sphere's own emissive stays LOW so it
  // still shades into a solid at close range — the halo is what carries it at distance, and the
  // two are separate on purpose. Dropping both together is what made the wide view look empty.
  // ─── LARGE AND SOFT BEATS SMALL AND BRIGHT ──────────────────────────────────────────────────
  //
  // Additive blending saturates: past a certain opacity the centre of every glow clips to WHITE and
  // the type colour — the dominant signal in this whole pipeline — is destroyed at exactly the
  // bodies the eye goes to first. Reach comes from the screen floor above; this stays low enough
  // that an azure client still reads as azure rather than as another white dot.
  const haloOpacity = Math.min(0.7, 0.22 * body.emissiveStrength * haloAttention);
  // ─── THE SELECTED BODY LOSES ITS SCREEN FLOOR, AND THAT IS THE POINT ────────────────────────
  //
  // The floor keeps a body visible when the whole galaxy is framed and its geometry is a fraction
  // of a pixel. On the real graph that floor is a hundred world units against a sphere of under
  // one — so a camera that flew close enough to SEE the sphere ended up inside the halo, and the
  // whole frame washed out in the body's own colour.
  //
  // Selecting now moves the camera onto the object, so a selected body is never the thing that
  // needs rescuing from being sub-pixel: it is the thing being looked at. It is drawn at its true
  // size, and the glow is scaled to the geometry rather than to the floor.
  // ─── THE SCREEN FLOOR IS FOR THE WIDE VIEW ONLY ─────────────────────────────────────────────
  //
  // It keeps a body visible when the whole galaxy is framed and its geometry is a fraction of a
  // pixel. On the real graph that floor is a hundred world units against a sphere of under one — so
  // in a view where the camera is right beside the objects it does not rescue anything, it engulfs
  // the frame in the nearest body's colour.
  //
  // Two situations where nothing needs rescuing, and both drop it: the SELECTED body, which is what
  // the camera flew to, and every body in a SCOPED view, where ten objects are on screen instead of
  // three thousand and the camera has already been brought to them.
  // ─── ONE MAGNIFICATION, APPLIED TO BOTH ─────────────────────────────────────────────────────
  //
  // When the galaxy is scaled down to fit, a body is magnified just enough to keep its SPHERE above
  // a readable size — and its glow is magnified by exactly the same factor, so the two stay in
  // proportion. Flooring only the glow is what made small bodies flat: a sub-pixel sphere inside a
  // sprite twenty times its size is a sprite, however carefully the sphere is shaded.
  //
  // The selected body is exempt. The camera has flown to it, so it needs no rescuing from being
  // small, and magnifying it would put the camera inside its own glow.
  const magnify = floored && !selected
    ? Math.max(1, body.minBody / scale / body.radius)
    : 1;
  const drawnRadius = body.radius * magnify;
  const haloSize = body.halo * magnify;

  return (
    <group ref={anchor}>
      {/*
        THE HALO IS ALSO THE HIT TARGET. It was a third, invisible sphere until the real graph turned
        out to hold 3,226 objects — at which point every extra object per body cost 3,226 draw calls.
        The halo is a billboard, so it always faces the camera and its hit area is exactly the glow
        the operator can see, which is a better target than a sphere behind it as well as a cheaper
        one. A two-unit moon stays as clickable as a sun because the halo has a floor.
      */}
      <sprite
        scale={[haloSize, haloSize, 1]}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onSelect(body.id); }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(body.id); }}
        onPointerOut={() => onHover(null)}
      >
        <spriteMaterial
          map={dot}
          color={body.color}
          transparent
          opacity={haloOpacity}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>

      <mesh raycast={() => null}>
        <sphereGeometry args={[drawnRadius, SPHERE_SEGMENTS, SPHERE_SEGMENTS]} />
        {/*
          A SOLID SURFACE FIRST, A LIGHT SECOND.
          `emissiveIntensity` was high enough to saturate the whole sphere, so every body rendered
          as a flat disc of pure colour — the shading was there and was being drowned by its own
          glow. Emissive is now a fraction of what it was and the lighting does the work: a bright
          lit side, a dark side, and a soft specular roll-off across the terminator, which is what
          the eye reads as "solid".
        */}
        <meshStandardMaterial
          color={body.color}
          emissive={body.color}
          emissiveIntensity={emissive}
          roughness={0.38}
          metalness={0.06}
        />
      </mesh>
    </group>
  );
}

// ── ONE ORBIT ──────────────────────────────────────────────────────────────────────────────────

/**
 * One body placed on its orbit, with whatever orbits IT nested inside.
 *
 * Three groups, and between them they are the whole of the motion system:
 *
 *   1. the orbital PLANE, tilted once and never touched again
 *   2. the TRAVEL along that plane — the only thing a frame advances, and it advances a rotation
 *   3. the body's REST POSITION in the plane, straight from the model
 *
 * Children are nested inside (3), so they inherit their parent's travel automatically: a moon is
 * positioned relative to its planet and carried by it, exactly as the arrangement claims. No child
 * coordinate is ever recomputed, and no body is ever moved — a matrix is.
 */
function Orbiter({
  body, children, dot, scale, floored, drawn, selectedId, hoverId, focusId, onSelect, onHover,
}: {
  body: CelestialBody;
  floored: boolean;
  /**
   * Whether this body is DRAWN. Its frame is built either way.
   *
   * With something selected, everything outside its neighbourhood is left out of the picture — three
   * thousand unrelated specks behind the object you are looking at is noise, not context. But the
   * groups still mount: a moon positioned inside a hidden planet's frame would otherwise lose the
   * transform its coordinates are measured against, and would be drawn in the wrong place.
   */
  drawn: boolean;
  children: React.ReactNode;
  dot: THREE.Texture;
  scale: number;
  selectedId: string | null;
  hoverId: string | null;
  focusId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const travel = useRef<THREE.Group>(null);
  const speed = body.orbit?.speed ?? 0;

  // The ONLY per-frame write in the body path, and it writes a rotation. `set` rather than an
  // assignment to a component, so nothing here can be mistaken for — or become — a position write.
  useFrame((state) => {
    travel.current?.rotation.set(0, 0, state.clock.elapsedTime * speed);
  });

  const painted = (
    <>
      {drawn && <Body
        body={body}
        dot={dot}
        scale={scale}
        floored={floored}
        selected={body.id === selectedId}
        hovered={body.id === hoverId}
        dimmed={focusId !== null && body.id !== focusId}
        onSelect={onSelect}
        onHover={onHover}
      />}
      {children}
    </>
  );

  // An unanchored body cannot be shown travelling, because what it travels around is not on screen.
  // It is placed where the layout put it and stays there. Honest, and visibly still.
  if (!body.orbit) return <group position={[body.x, body.y, body.z]}>{painted}</group>;

  return (
    <group rotation={[body.orbit.tilt, 0, 0]}>
      <group ref={travel}>
        <group position={[body.orbit.planeX, body.orbit.planeY, 0]}>{painted}</group>
      </group>
    </group>
  );
}

// ── THE LATTICE ────────────────────────────────────────────────────────────────────────────────

/**
 * Every relationship, as one line-segment buffer rewritten each frame from where the bodies ARE.
 *
 * One draw call for the whole graph rather than one per edge, which is what makes a moving lattice
 * affordable. Endpoints come from the registry — three.js's own world matrices — so a line always
 * joins the two objects it names, however far their systems have turned.
 */
function Lattice({ model, neighbourhood }: { model: CelestialModel; neighbourhood: Set<string> | null }) {
  const registry = useContext(Registry);

  // ─── TWO BUFFERS, BECAUSE THE TWO KINDS OF EDGE ARE NOT THE SAME LENGTH ──────────────────────
  //
  // A CONTAINMENT edge joins a client to its own project: it is short, it sits inside one system,
  // and drawing it is what makes a system look assembled rather than coincidental.
  //
  // A LATERAL edge — `billed`, `promoted_to`, `flags` — joins two independent roots, and in a disc
  // whose whole point is that unrelated things are far apart, it crosses the entire galaxy. At any
  // opacity where a containment edge reads, twenty of those become the dominant feature of the
  // frame: a cat's cradle stretched over everything.
  //
  // Both are drawn, and neither is hidden — they are drawn at the weights their LENGTHS deserve.
  // Relationship WORK does not happen here in any case: SceneList states every relationship in
  // words, and traversal follows them, for lateral and containment alike.
  const split = useMemo(() => {
    // A link is drawn only when BOTH ends are — otherwise a selection would leave lines running off
    // to objects it has just hidden.
    const shown = (id: string) => neighbourhood === null || neighbourhood.has(id);
    const links = model.links.filter((l) => shown(l.source) && shown(l.target));
    return {
      containment: links.filter((l) => l.containment),
      lateral: links.filter((l) => !l.containment),
    };
  }, [model, neighbourhood]);

  const buffers = useMemo(() => ({
    containment: new THREE.BufferGeometry().setAttribute(
      "position", new THREE.BufferAttribute(new Float32Array(split.containment.length * 6), 3)),
    lateral: new THREE.BufferGeometry().setAttribute(
      "position", new THREE.BufferAttribute(new Float32Array(split.lateral.length * 6), 3)),
  }), [split]);
  useEffect(() => () => { buffers.containment.dispose(); buffers.lateral.dispose(); }, [buffers]);

  const scratch = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!registry) return;
    for (const [links, geometry] of [
      [split.containment, buffers.containment] as const,
      [split.lateral, buffers.lateral] as const,
    ]) {
      const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < links.length; i++) {
        const from = registry.get(links[i].source);
        const to = registry.get(links[i].target);
        const base = i * 6;
        // A link whose endpoint is not mounted collapses to nothing rather than drawing to a stale
        // place. It must never draw a relationship to somewhere an object used to be.
        if (!from || !to) { array.fill(0, base, base + 6); continue; }
        from.getWorldPosition(scratch);
        array[base] = scratch.x; array[base + 1] = scratch.y; array[base + 2] = scratch.z;
        to.getWorldPosition(scratch);
        array[base + 3] = scratch.x; array[base + 4] = scratch.y; array[base + 5] = scratch.z;
      }
      attribute.needsUpdate = true;
    }
  });

  return (
    <>
      <lineSegments geometry={buffers.containment} raycast={() => null} frustumCulled={false}>
        <lineBasicMaterial
          color="#8fb4d8" transparent opacity={0.34} depthWrite={false}
          blending={THREE.AdditiveBlending} toneMapped={false}
        />
      </lineSegments>
      <lineSegments geometry={buffers.lateral} raycast={() => null} frustumCulled={false}>
        <lineBasicMaterial
          color="#4a6076" transparent opacity={0.03} depthWrite={false}
          blending={THREE.AdditiveBlending} toneMapped={false}
        />
      </lineSegments>
    </>
  );
}

// ── THE CORE ───────────────────────────────────────────────────────────────────────────────────

/**
 * The Ascend core — RENDERER CHROME, NOT A BUSINESS OBJECT.
 *
 * A dark body inside a burning ring: the centre every parentless object already orbits, made
 * visible. It is not a SceneNode and never becomes one — absent from `scene.nodes`, from the
 * accessible list, from every count, from traversal and from selection, and deliberately not
 * pickable. Fabricating a node to represent Ascend itself would put an object on screen that no
 * authorized reader produced.
 */
function AscendCore({ dot, gap }: { dot: THREE.Texture; gap: number }) {
  // ─── SIZED FROM THE HOLE THE LAYOUT LEAVES, NEVER FROM A CONSTANT ────────────────────────────
  //
  // GalaxyLayout keeps a clear zone at the centre that no object may enter, and the centre of the
  // galaxy is what belongs in it. `gap` is the distance to the nearest body, so the core fills its
  // own clear zone at ANY size of graph — and because that zone is a FRACTION of the disc's span
  // rather than a fixed distance, the proportion holds whether the business has thirty objects or
  // thirty thousand. A constant radius here would swallow the inner disc on a large graph and look
  // like a marble on a small one.
  //
  // It had two rotating accretion rings and they are gone. They were the only moving thing here
  // that was not an orbit, and against three thousand bodies they read as an ornament laid over the
  // picture rather than as part of it.
  const body = gap * 0.62;

  return (
    <group raycast={() => null}>
      {/*
        THE LIGHT OF THE GALAXY, and it is a real light rather than a painted one. Every body uses a
        lit material, so this is what gives them a terminator — a lit side and a dark one — which is
        the whole difference between a sphere and a flat disc. `decay={0}` on purpose: physical
        falloff would light the inner disc and leave the rim dark, and the rim is where three
        thousand bodies live. The ambient term keeps their night sides off pure black.
      */}
      <pointLight color="#fff6e8" intensity={13} distance={0} decay={0} />
      <ambientLight color="#9db4d8" intensity={0.85} />

      {/* The photosphere. White and past full brightness, so bloom carries it beyond its edge. */}
      <mesh raycast={() => null}>
        <sphereGeometry args={[body, 64, 64]} />
        <meshBasicMaterial color="#fffdf8" toneMapped={false} />
      </mesh>

      {/*
        THE CORONA, IN THREE LAYERS. A single haze sprite was tried at 4.6x the clear zone and it
        turned the whole frame into a flat orange wash with the bodies floating on top. Stacked
        layers at falling opacity give a FALLOFF instead of a wash — bright and tight at the
        surface, fading to nothing well before the disc.
      */}
      <sprite scale={[gap * 1.55, gap * 1.55, 1]} raycast={() => null}>
        <spriteMaterial map={dot} color="#fff3dd" transparent opacity={0.34}
          depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite scale={[gap * 2.5, gap * 2.5, 1]} raycast={() => null}>
        <spriteMaterial map={dot} color="#ffd9a0" transparent opacity={0.14}
          depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <sprite scale={[gap * 4.4, gap * 4.4, 1]} raycast={() => null}>
        <spriteMaterial map={dot} color="#ffb066" transparent opacity={0.06}
          depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  );
}

// ── CAMERA ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Orbit / dolly / pan, the fit that frames the whole galaxy, a slow drift while idle — and FOLLOW.
 *
 * ─── FOLLOWING IS NOT OPTIONAL IN A GALAXY THAT MOVES ──────────────────────────────────────────
 *
 * Focusing an object in a still picture is a one-off camera move. Here every body is travelling its
 * orbit, so a camera that jumped to where a body WAS would watch it leave the frame within seconds.
 * Focus therefore has two halves: a dolly onto the object, and a per-frame correction that carries
 * the camera along with it.
 *
 * The correction moves the target and the camera by the SAME delta, so the operator's own orbiting,
 * panning and zooming survive being followed — they keep whatever angle and distance they chose,
 * relative to a body that is moving underneath them.
 *
 * Where the body IS comes from the registry — three.js's own world matrices — which is reading the
 * result of the layout, not recomputing it. No coordinate is authored here.
 */
function Controls({
  fitToken, drift, focusId, focusExtent,
}: { fitToken: number; drift: boolean; focusId: string | null; focusExtent: number }) {
  const { camera, gl, invalidate } = useThree();
  const registry = useContext(Registry);
  const controls = useRef<OrbitControls | null>(null);
  const following = useRef<string | null>(null);
  const next = useMemo(() => new THREE.Vector3(), []);
  const offset = useMemo(() => new THREE.Vector3(), []);
  const heading = useMemo(() => new THREE.Vector3(), []);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const glideLeft = useRef(0);

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    // Damping and auto-drift both need a frame every tick. They are enabled exactly when the loop is
    // running, and left off in the reduced-motion mode where an untouched Galaxy must render nothing.
    c.enableDamping = drift;
    c.dampingFactor = 0.055;
    c.autoRotate = drift;
    c.autoRotateSpeed = 0.16;
    // These were 220 and 26,000, chosen against a fixture of 83 objects. The real console held
    // 3,226, whose disc is far wider — so the fit wanted to sit outside the clamp, OrbitControls
    // pulled the camera into the empty middle, and the screen went black with nothing logged. They
    // are safe as constants now only because the galaxy is normalised to one size before this runs.
    // Dolly toward whatever is under the pointer instead of toward the orbit target. Without this
    // every scroll drives at the galactic centre, so reaching a body out in the disc means zooming
    // in on the core and then panning back out to find it — which is most of the field.
    c.zoomToCursor = true;
    c.minDistance = MIN_ORBIT_DISTANCE;
    c.maxDistance = MAX_ORBIT_DISTANCE;
    // Every camera change asks for exactly one frame — the only thing that repaints the reduced
    // motion mode. Wrapped rather than passed directly: OrbitControls hands its listener an event,
    // and `invalidate`'s first parameter is a frame count.
    const requestFrame = () => invalidate();
    c.addEventListener("change", requestFrame);
    // ANY DELIBERATE INPUT ENDS THE GLIDE. While the camera is flying to a newly focused body it
    // is being driven toward a goal, so a wheel or a drag in that window was partly overwritten —
    // zooming immediately after a click behaved differently depending on how far the flight had
    // got. The operator's hand always wins: the glide stops and the rigid lock takes over at once.
    const yieldToOperator = () => { glideLeft.current = 0; };
    c.addEventListener("start", yieldToOperator);
    controls.current = c;
    return () => {
      c.removeEventListener("change", requestFrame);
      c.removeEventListener("start", yieldToOperator);
      c.dispose();
    };
  }, [camera, gl, invalidate, drift]);

  useEffect(() => {
    const distance = WORLD_RADIUS * FIT_DISTANCE;
    camera.position.set(distance * 0.24, -distance * 0.46, distance * 0.78);
    camera.lookAt(FIT_TARGET);
    if (controls.current) { controls.current.target.copy(FIT_TARGET); controls.current.update(); }
    invalidate();
  }, [camera, fitToken, invalidate]);

  // ─── FOCUS LOCKS ONTO THE OBJECT; IT DOES NOT TRACK IT ──────────────────────────────────────
  //
  // Two bugs lived here, and the second is why this is a LOCK rather than a follow.
  //
  // FIRST: the dolly was a `useEffect` that read the registry ONCE. On a selection the whole tree
  // re-commits, so the focused body was sometimes not registered at that instant — and the effect
  // then set `following` to null and NEVER RETRIED. Intermittent by construction. The frame loop
  // owns focus now: if the object is not there yet, the next frame asks again.
  //
  // SECOND, and the one that survived that fix: the follow moved the target and the camera by the
  // object's DELTA each frame. That is only correct if nothing else ever moves the target — and
  // several things do. `zoomToCursor` deliberately moves the target on every scroll so the point
  // under the pointer stays put. Panning moves it. Damping keeps moving it for a while afterwards.
  // Every one of those displacements is permanent under delta-tracking: the object slides out of
  // frame and the camera never comes back, which is exactly the reported symptom.
  //
  // So each frame the target is SET to where the object is, and the camera is placed at that point
  // plus the offset the operator currently has. Orbiting and dollying are preserved — they change
  // the offset — and any drift from any source is corrected on the very next frame rather than
  // accumulating. A lock cannot drift; a tracker can only hope nothing else interferes.
  //
  // Cursor-zoom is disabled WHILE LOCKED, below, because the two want the target in different
  // places and the lock has to win.
  useFrame((state, dt) => {
    const c = controls.current;
    if (!c) return;

    const object = focusId !== null && registry ? registry.get(focusId) : undefined;
    if (!object) {
      // Nothing selected, or not mounted yet. Leave the camera alone and try again next frame.
      if (focusId === null) { following.current = null; glideLeft.current = 0; }
      c.update();
      return;
    }

    object.getWorldPosition(next);

    // ─── THREE WAYS THE LOCK COULD BE THROWN, AND ALL OF THEM WERE STICKY ───────────────────────
    //
    // The offset is re-read from the live camera every frame, so ANY bad value it once contained is
    // carried forward for ever — the camera never recovers on its own, which is exactly the
    // "sometimes it gets thrown out and stays out" this guards.
    //
    //   1. A DEGENERATE POSITION. If the object's world matrix has not been applied yet,
    //      `getWorldPosition` answers the origin. No real body can be there — GalaxyLayout keeps a
    //      clear zone of thousands of units around the centre — so the origin means "not ready",
    //      and the honest response is to wait a frame rather than to fly the camera to the middle
    //      of the galaxy.
    //
    //   2. A NON-FINITE OFFSET. `Vector3.normalize()` on a zero-length vector divides by zero and
    //      yields NaN, and NaN in `camera.position` is absorbing: every later frame computes
    //      `offset = NaN - target`, so one bad frame breaks the camera until a reset.
    //
    //   3. AN ABSURD DISTANCE. Anything that displaces the camera — a cursor-zoom mid-lock, a
    //      pinch, a stray wheel event — could put it far enough away that the object is a subpixel,
    //      which reads as "the camera was thrown out" even though it is still perfectly locked on.
    //
    // Each is DETECTED and REPAIRED rather than merely avoided: the frame re-runs the dolly, which
    // puts the camera back at a sane distance along a sane heading. A lock that can heal is worth
    // more than one that is merely careful.
    const ready = next.lengthSq() > 1;
    if (!ready) { c.update(); return; }

    const distance = Math.max(focusExtent * FOCUS_DISTANCE, MIN_FOCUS_DISTANCE);
    let redolly = following.current !== focusId;

    // The offset is the operator's own framing — their angle and distance — and it is re-read from
    // the live camera ONLY when the camera is theirs to move.
    //
    // NOT WHILE GLIDING. Re-reading it mid-flight makes the goal chase the camera it is derived
    // from, so the approach never converges: the camera settles wherever it started, which on a
    // fresh selection is the whole-galaxy fit distance. The object ends up centred and a pixel
    // wide, which looks exactly like the dolly not having run at all.
    if (!redolly && glideLeft.current <= 0) {
      offset.subVectors(camera.position, c.target);
      const reach = offset.length();
      if (!Number.isFinite(reach) || reach < distance * 0.3 || reach > distance * 30) redolly = true;
    }

    if (redolly) {
      // Approach along the direction the operator is already looking from, so focusing re-frames
      // without spinning the galaxy under them — falling back to a fixed heading when there is no
      // usable direction, which is the case that produced NaN.
      heading.subVectors(camera.position, c.target);
      if (!(heading.lengthSq() > 1e-6)) heading.set(0, -0.5, 1);
      offset.copy(heading).normalize().multiplyScalar(distance);
      if (!Number.isFinite(offset.lengthSq())) offset.set(0, -0.5, 1).normalize().multiplyScalar(distance);
      following.current = focusId;
      glideLeft.current = GLIDE_SECONDS;
    }

    // ─── GLIDE IN, THEN LOCK ────────────────────────────────────────────────────────────────────
    //
    // Focusing used to TELEPORT: the camera cut from wherever it was to the new body with no
    // motion in between, which is the least fluid thing in a scene that is otherwise all motion,
    // and it costs the viewer their sense of where the object was relative to everything else.
    //
    // The approach is damped exponentially and frame-rate independently, so it takes the same wall
    // time on any display. It hands over to the RIGID lock the moment it arrives, because a spring
    // that never settles would fight the operator's own orbiting and dollying for ever.
    goal.copy(next).add(offset);
    if (glideLeft.current > 0) {
      glideLeft.current -= Math.min(dt, 0.1);
      const alpha = 1 - Math.exp(-FOCUS_GLIDE * Math.min(dt, 0.1));
      c.target.lerp(next, alpha);
      camera.position.lerp(goal, alpha);
    } else {
      // RIGID. Exactly on the object, every frame, with the operator's own framing preserved.
      c.target.copy(next);
      camera.position.copy(goal);
    }

    c.update();
  });

  // Cursor-zoom moves the orbit target so the point under the pointer stays fixed, which is right
  // when you are flying around the galaxy and wrong when you are locked onto one body — the two
  // would fight over the target every frame. Locked, the zoom goes toward the object instead.
  useEffect(() => {
    if (controls.current) controls.current.zoomToCursor = focusId === null;
  }, [focusId]);

  // Reduced motion runs the loop on demand, so a selection has to ASK for the frame that performs
  // the dolly — otherwise focusing would do nothing at all in that mode.
  useEffect(() => { invalidate(); }, [focusId, focusExtent, invalidate]);

  return null;
}

// ── THE SCENE ──────────────────────────────────────────────────────────────────────────────────

type Props = {
  scene: Scene;
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  /** Bumped by the parent to request a re-fit. */
  fitToken: number;
  /**
   * Whether the operator accepts motion.
   *
   * `false` is `prefers-reduced-motion`, and it is a real mode rather than a slower one: the frame
   * loop returns to `demand`, every orbit sits at its layout position, and an untouched Galaxy
   * renders nothing at all.
   */
  motion: boolean;
  /**
   * The selection's neighbourhood, or `null` when nothing is selected.
   *
   * DERIVED IN THE COMPOSER and shared with SceneList, so both surfaces narrow to exactly the same
   * set. A galaxy that hid a different set from the one the list showed would be two answers to
   * "what is this connected to".
   */
  neighbourhood: Set<string> | null;
};

/** Children of each body, by anchor. Built once per model; the render walks it. */
function childrenByAnchor(model: CelestialModel): Map<string | null, CelestialBody[]> {
  const tree = new Map<string | null, CelestialBody[]>();
  const drawn = new Set(model.bodies.map((b) => b.id));
  for (const body of model.bodies) {
    // A body with no orbit hangs off the root: it is placed absolutely and belongs to no frame.
    // `anchorId` is a PLACEMENT fact carried down from the layout, not a relationship read from an
    // edge — the hierarchy this walk draws is the one that decided the coordinates, and it has to
    // be, or a body would be nested in a frame its position was never measured against.
    const anchor = body.orbit && body.orbit.anchorId !== null && drawn.has(body.orbit.anchorId)
      ? body.orbit.anchorId
      : null;
    const siblings = tree.get(anchor);
    if (siblings) siblings.push(body);
    else tree.set(anchor, [body]);
  }
  return tree;
}

export function GalaxyScene3D({
  scene, selectedId, hoverId, onSelect, onHover, fitToken, motion, neighbourhood,
}: Props) {
  const model = useMemo(() => toCelestialModel(scene), [scene]);
  const tree = useMemo(() => childrenByAnchor(model), [model]);
  const registry = useMemo(() => new Map<string, THREE.Object3D>(), []);
  const dot = useMemo(() => softDotTexture(), []);
  useEffect(() => () => dot.dispose(), [dot]);

  // Framing input: the bounding sphere of what exists, and the factor that brings it to WORLD_RADIUS.
  // Computed from the bodies, never guessed — and the galaxy is centred on the CORE rather than on
  // its own centroid, because the core is what everything orbits and a drifting centre would make
  // the view lurch every time an object appeared.
  // The factor that brings whatever the layout produced to WORLD_RADIUS. Measured from the core
  // outward rather than from the bodies' centroid, because the core is what everything orbits and a
  // drifting centre would make the view lurch every time an object appeared.
  const { scale, gap } = useMemo(() => {
    let extent = 0;
    let nearest = Infinity;
    for (const b of model.bodies) {
      const d = Math.hypot(b.x, b.y, b.z);
      extent = Math.max(extent, d + b.radius);
      nearest = Math.min(nearest, d - b.radius);
    }
    if (extent === 0) return { scale: 1, gap: WORLD_RADIUS * 0.25 };
    const k = WORLD_RADIUS / extent;
    // The core's room to be the centre of the galaxy: the clear zone the layout left, in world
    // units — BOUNDED AT BOTH ENDS.
    //
    // The floor is for a graph with something improbably close to the origin. The ceiling is for the
    // opposite case and was found the hard way: the clear zone is `max(ROOT_SEPARATION, span × f)`,
    // and on a SMALL graph the fixed separation dominates a short span, so the hole — and therefore
    // the core — came out as a third of the whole galaxy. At twenty-six bodies the nucleus filled
    // the frame. The hole is a layout distance; how much of the FRAME the core is allowed to take
    // is a framing decision, and it belongs here.
    return {
      scale: k,
      gap: Math.min(Math.max(nearest * k, WORLD_RADIUS * 0.04), WORLD_RADIUS * 0.13),
    };
  }, [model]);

  // The SELECTED body, for the camera. Distinct from `labelled` below, which prefers the hover — a
  // camera that flew to whatever the pointer brushed past would be unusable.
  const selected = useMemo(
    () => (selectedId ? model.bodies.find((b) => b.id === selectedId) ?? null : null),
    [model, selectedId]);

  const drawnLinks = useMemo(() => {
    if (neighbourhood === null) return model.links.length;
    return model.links.filter((l) => neighbourhood.has(l.source) && neighbourhood.has(l.target)).length;
  }, [model, neighbourhood]);

  const labelled = selectedId ?? hoverId;
  const focus = labelled ? model.bodies.find((b) => b.id === labelled) ?? null : null;

  const branch = (anchor: string | null): React.ReactNode =>
    (tree.get(anchor) ?? []).map((body) => (
      <Orbiter
        key={body.id}
        body={body}
        dot={dot}
        scale={scale}
        floored={neighbourhood === null}
        drawn={neighbourhood === null || neighbourhood.has(body.id)}
        selectedId={selectedId}
        hoverId={hoverId}
        focusId={selectedId}
        onSelect={onSelect}
        onHover={onHover}
      >
        {branch(body.id)}
      </Orbiter>
    ));

  return (
    <>
      <Canvas
        frameloop={motion ? "always" : "demand"}
        camera={{ fov: 48, near: CAMERA_NEAR, far: CAMERA_FAR }}
        gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.32 }}
        style={{ position: "absolute", inset: 0 }}
        onPointerMissed={() => onSelect(null)}
        aria-hidden="true"
      >
        <color attach="background" args={["#000000"]} />
        {/* Just enough exponential fog that distance reads as distance and the far side dims. */}
        <fogExp2 attach="fog" args={["#000000", 0.00009]} />

        {/*
          ─── EVERY SUBSYSTEM FAILS ALONE ───────────────────────────────────────────────────────
          A throw anywhere in a React subtree unmounts the whole subtree, so before this the
          backdrop, the lattice and the bloom pass could each take the entire galaxy down and leave
          a black rectangle with nothing to read. The bodies are what this surface is FOR; losing
          the decoration around them must never cost them.

          `fallback={null}` rather than a message, because these boundaries sit INSIDE the Canvas
          and returning a DOM node here would crash the three.js reconciler. The message belongs
          outside, where GalaxyView's boundary puts it; in here a failure degrades the picture.
        */}
        <SurfaceBoundary label="Core marker" fallback={null}>
          <AscendCore dot={dot} gap={gap} />
        </SurfaceBoundary>

        {/*
          THE NORMALISING GROUP. Everything the layout placed lives inside it; the backdrop and the
          core marker stay outside, in fixed world units, because they are chrome and decoration
          rather than placed objects. A uniform scale about the origin — no relative position,
          proportion or clearance changes, and the lattice reads world positions through three.js
          so its endpoints follow automatically.
        */}
        <group scale={scale}>
          <Registry.Provider value={registry}>
            <SurfaceBoundary label="Lattice" fallback={null}>
              <Lattice model={model} neighbourhood={neighbourhood} />
            </SurfaceBoundary>
            {branch(null)}
            <Controls
              fitToken={fitToken}
              drift={motion}
              focusId={selectedId}
              focusExtent={selected ? Math.max(selected.radius, selected.halo) * scale : 0}
            />
          </Registry.Provider>
        </group>


        {/*
          The bloom pass is what turns small bright spheres into a galaxy. The threshold is low
          because every body is emissive by design; the mipmap blur is what gives the wide, soft
          falloff rather than a hard ring.
        */}
        {/*
          ─── THE GRADE, IN THE ORDER IT HAS TO RUN ─────────────────────────────────────────────
          BLOOM is what turns a small bright sphere into a star. The threshold is high enough that
          only genuinely luminous things bleed, so a lit planet keeps its edge.

          SATURATION and CONTRAST are here because of what the tone mapper does NOT do. This scene
          ran on ACES, which compresses luma AND pushes colour toward white as it brightens — so
          every body that mattered bleached out at exactly the moment it got bright enough to look
          at, and the whole picture read as dull. `NeutralToneMapping` (Khronos PBR Neutral) is
          built for the opposite: it preserves hue and saturation through the highlights. It is also
          flatter by design, which is what the contrast lift answers.

          VIGNETTE settles the frame. SMAA is last because the composer disables the renderer's own
          multisampling, and without it every sphere's limb is a staircase.
        */}
        <SurfaceBoundary label="Bloom" fallback={null}>
          <EffectComposer multisampling={0}>
            <Bloom intensity={0.72} luminanceThreshold={0.34} luminanceSmoothing={0.32} mipmapBlur radius={0.72} />
            <HueSaturation saturation={0.28} />
            <BrightnessContrast contrast={0.14} />
            <Vignette offset={0.26} darkness={0.7} />
            <SMAA />
          </EffectComposer>
        </SurfaceBoundary>
      </Canvas>

      {/*
        PROOF OF LIFE, and it earns its place. A black rectangle is what an empty graph, a crashed
        renderer, a lost WebGL context and a camera pointed at nothing all look like. This chip is
        rendered outside the Canvas from the model itself, so if it says "83 bodies" the pipeline
        ran and the problem is in the picture — and if it is absent, the component never mounted.
      */}
      <p style={{
        position: "absolute", top: 18, left: 18, margin: 0, pointerEvents: "none",
        padding: "5px 10px", borderRadius: 4,
        border: `1px solid ${SEMANTIC.line}`, background: "rgba(4,6,10,0.72)",
        color: SEMANTIC.text3, letterSpacing: "0.08em",
        font: "10px ui-monospace, SFMono-Regular, Menlo, monospace",
      }}>
        {neighbourhood ? `${neighbourhood.size} OF ${model.bodies.length}` : `${model.bodies.length}`} BODIES
        {" · "}{drawnLinks} LINKS{motion ? " · LIVE" : " · STILL"}
      </p>

      {/*
        SELECTED AND HOVERED ONLY. A hundred labels in perspective is noise, and the SceneList remains
        the complete semantic surface — this is an aid, never the source of identity.
      */}
      {focus && (
        <p style={{
          position: "absolute", bottom: 18, left: 18, margin: 0, pointerEvents: "none",
          padding: "6px 11px", borderRadius: 4,
          border: `1px solid ${SEMANTIC.line}`, background: "rgba(4,6,10,0.72)",
          color: SEMANTIC.text1, letterSpacing: "0.04em",
          font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
        }}>
          {focus.label}
        </p>
      )}
    </>
  );
}
