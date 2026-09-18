// components/galaxy/shaders/star — 160,000 STARS FOR ONE UNIFORM WRITE A FRAME (brief §5).
//
// ─── WHY THE POSITIONS ARE COMPUTED ON THE GPU ─────────────────────────────────────────────────
//
// Moving 160,000 points from JavaScript means 480,000 float writes and a buffer upload every frame.
// That is the whole frame budget, and it is spent before anything is drawn. Computing them in the
// vertex shader costs nothing per frame: the per-star constants are uploaded ONCE, and the only
// thing that changes between frames is a single float.
//
// ─── THIS IS NOT A SECOND PLACEMENT AUTHORITY ──────────────────────────────────────────────────
//
// The distinction matters, because a shader that decided where stars go would put the picture out
// of the model's reach exactly the way a renderer computing `cos(phase) * radius` would — and F65
// exists because that happened.
//
// What this shader is given is an ORBIT: semi-major axis, axis ratio, ellipse tilt, initial phase,
// angular rate, height. All six come from `graph-view/field/spiral`, which is the layout layer, and
// the shader only evaluates the closed form of that orbit at time t. It is the same arrangement as
// rotating a `<group>` and letting three.js multiply the matrices — the model says where the orbit
// is, the frame says how far along it. At `uTime = 0` the result is the rest position the layout
// also wrote into `position`, and `tests/graph/galaxy-spiral.test.ts` asserts that equivalence
// rather than assuming it.
//
// ─── THE OVERDRIVE IS THE WHOLE LOOK ───────────────────────────────────────────────────────────
//
// `core * 2.2` pushes bright stars past 1.0. Values above 1.0 are what the bloom pass selects on,
// and ACES is what rolls them back to white instead of clipping them into flat discs. That
// overdrive plus tone mapping is the single biggest factor in whether this reads as a photograph;
// an 8-bit framebuffer destroys it, which is why the composer runs at half float.
//
// The included chunks are not optional. `logdepthbuf` is required because the scene spans four
// decades of depth and the renderer is in logarithmic mode — without it these points depth-test
// against everything else using a different depth encoding, and stars punch through planets.
// `tonemapping` and `colorspace` are injected automatically into three's own materials and NOT into
// a custom one, so omitting them leaves this the only object in the scene rendering in linear light.

export const STAR_VERTEX = /* glsl */ `
  attribute float aSemiMajor;
  attribute float aAxisRatio;
  attribute float aTilt;
  attribute float aPhase;
  attribute float aOmega;
  attribute float aY;
  attribute float aMagnitude;
  attribute vec3 aColor;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uSizeScale;
  uniform float uMaxPointSize;
  uniform float uReferenceDistance;
  uniform float uFade;

  varying vec3 vColor;
  varying float vAlpha;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    // The closed form of the orbit this star was handed. Nothing here is stored, integrated, or
    // fed back: evaluate at any t and you get that t's frame, with no drift and no state.
    float phi = aPhase + aOmega * uTime;
    float b = aSemiMajor * aAxisRatio;
    float x0 = aSemiMajor * cos(phi);
    float z0 = b * sin(phi);

    float ct = cos(aTilt);
    float st = sin(aTilt);
    vec3 world = vec3(x0 * ct - z0 * st, aY, x0 * st + z0 * ct);

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    // ─── PERSPECTIVE POINT SIZE, AND WHY THE REFERENCE DISTANCE IS NOT 300 ───────────────────
    //
    // §5 writes this as 300.0 / -mvPosition.z — at §10's galaxy-level camera distance of 3400 that
    // factor is 0.088, so a median star of magnitude 0.55 renders at 0.06 pixels and is clamped to
    // the 0.6 floor — i.e. EVERY star in the field comes out the same size, which is precisely the
    // "uniform points read as dust" failure §16.1 puts first. The first run of this shader drew a
    // bright bulge on an empty field for exactly that reason.
    //
    // The 300 is a scale-dependent constant, like §5's ANGULAR_OFFSET, and the fix is the same:
    // state it as the distance the composition was framed at, so magnitude reads in CSS pixels at
    // the default view and the relationship survives a change to the rails.
    gl_PointSize = aMagnitude * uSizeScale * uPixelRatio * (uReferenceDistance / -mv.z);
    gl_PointSize = clamp(gl_PointSize, 0.6, uMaxPointSize);

    vColor = aColor;
    // Density rises sharply near the nucleus. Preserve individual light instead of clipping
    // overlapping inner populations into two featureless white lobes.
    vAlpha = uFade * mix(0.18, 1.0, smoothstep(180.0, 650.0, aSemiMajor));

    #include <logdepthbuf_vertex>
  }
`;

export const STAR_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    // A soft radial falloff, computed rather than sampled. A texture would need a browser
    // rasteriser, and F66 bans those outright after a canvas gradient's dithering turned into
    // coloured specks around every bright body in Safari and nowhere else.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float r = 1.0 - clamp(d, 0.0, 1.0);
    float core = pow(r, 6.0);        // tight bright centre
    float halo = pow(r, 1.6) * 0.28; // faint seed for the bloom pass to catch

    gl_FragColor = vec4(vColor * (core * 2.2 + halo), (core + halo) * vAlpha);

    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
