// components/galaxy/shaders/horizon — THE AMBIENT EVENT HORIZON.
//
// ─── WHAT "AMBIENT" MEANS HERE, AND WHY IT IS NOT DECORATION ───────────────────────────────────
//
// A black hole drawn as a black circle is a hole punched in the picture. It reads as absence — like
// something failed to render — because nothing in a photograph has an infinitely sharp edge and
// because the surroundings carry on right up to it as though nothing were there.
//
// What a real image shows is three nested things, and this shader is the middle one:
//
//     r < 1.0 rs      the horizon. True black, and the only true black in the scene.
//     r < 2.6 rs      the SHADOW. Also black, and almost three times wider — light aimed past the
//                     hole at less than this impact parameter is captured anyway.
//     r < ~6.8 rs     the AMBIENT band. Light here is not captured; it is deflected away from the
//                     viewer and dimmed. So the surroundings do not stop at the shadow, they FADE
//                     into it over a band roughly its own width again.
//
// The ambient band is what makes the object look like it is bending what is behind it rather than
// covering it. It is drawn as a camera-facing disc that MULTIPLIES what has already been rendered —
// ordinary alpha over black, which is arithmetically a dimming — so stars approaching the hole get
// progressively swallowed instead of blinking out at a rim.
//
// The falloff is cubic-ish rather than linear on purpose: a linear ramp has a visible outer edge of
// its own, which trades one hard boundary for another and looks like a vignette sitting on top of
// the scene.

export const HORIZON_VERTEX = /* glsl */ `
  varying vec2 vLocal;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    vLocal = position.xy;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

// ─── ONE SHADER, TWO PASSES, AND THE SPLIT IS NOT COSMETIC ────────────────────────────────────
//
// The first version drew capture and deflection as one disc, after the accretion disk. Both halves
// of that were wrong, and the picture showed it:
//
//   • THE DEFLECTION KILLED THE DISK. The ambient falloff reaches 176 units and the disk's inner
//     edge is at 78, so the brightest part of the accretion structure was being dimmed to 13% of
//     itself. The disk simply was not visible.
//   • THE CAPTURE LEFT A HOLE IN ITSELF. Drawn with depth testing, the disc was rejected wherever
//     the horizon sphere sat in front of it — so foreground bulge stars showed through the middle
//     of the shadow as a bright mottled ball. Exactly the region that must be black was the only
//     region that was not.
//
// So they are two passes with two jobs:
//
//   CAPTURE     opaque black out to the capture radius, drawn AFTER the disk with depth testing
//               OFF. Nothing inside the shadow reaches the viewer — not the far side of the disk,
//               not a star in front of it, not the horizon sphere. That is what a shadow IS.
//   AMBIENT     the falloff beyond it, drawn BEFORE the disk, so it swallows the starfield while
//               leaving the accretion structure — which is around and in front of the hole, not
//               behind it — at full brightness.

export const HORIZON_FRAGMENT = /* glsl */ `
  varying vec2 vLocal;

  uniform float uShadow;   // radius of the captured region, in world units
  uniform float uAmbient;  // radius at which the dimming has entirely gone
  uniform float uMode;     // 0 = capture, 1 = ambient falloff

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    float r = length(vLocal);
    float alpha;

    if (uMode < 0.5) {
      // Capture. Opaque to the edge, with a one-pixel-ish feather so the rim is not aliased — the
      // photon ring is drawn exactly here and a stair-stepped edge under it is very visible.
      alpha = 1.0 - smoothstep(uShadow * 0.985, uShadow, r);
    } else {
      // Deflection. Starts at full strength where the capture disc ends and fades to nothing by the
      // ambient radius. Squared, so it has no detectable outer edge of its own — a linear ramp
      // reads as a vignette sitting on the scene.
      float t = 1.0 - smoothstep(uShadow, uAmbient, r);
      alpha = clamp(t * t * 0.94, 0.0, 1.0);
    }

    // Colour is black. With ordinary alpha blending that is a multiply by (1 - alpha), which is the
    // dimming this exists for — not a grey disc laid over the scene.
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);

    #include <logdepthbuf_fragment>
  }
`;

// ─── THE AMBIENT HALO ─────────────────────────────────────────────────────────────────────────
//
// The warm light the core sits in, so the assembly belongs to the bulge rather than being pasted
// over it. It must be a FALLOFF, not a disc: the first version used a plain circle with a uniform
// colour at 5% opacity, and 5% of a warm tone over a large area with a hard rim reads as a flat tan
// sticker covering half the galaxy — which is exactly what it looked like.
//
// Cubic falloff, and it reaches zero at the edge by construction rather than by being faint enough
// that nobody notices where it stops.

export const GLOW_FRAGMENT = /* glsl */ `
  varying vec2 vLocal;

  uniform float uRadius;
  uniform float uIntensity;
  uniform vec3 uColour;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    float t = clamp(1.0 - length(vLocal) / uRadius, 0.0, 1.0);
    // Cubed, then lifted slightly at the centre so the innermost region is not a hot spot competing
    // with the accretion disk sitting inside it.
    float falloff = t * t * t * (0.55 + 0.45 * t);
    gl_FragColor = vec4(uColour * falloff * uIntensity, falloff);

    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ─── THE PHOTON RING ──────────────────────────────────────────────────────────────────────────
//
// It was a TorusGeometry, and that is wrong in a way that only shows at distance. Its tube radius
// is 0.012 rs — about a third of a world unit — and from the galaxy-level camera one pixel spans
// nearly four world units. So the ring was **a twelfth of a pixel thick**, rendered as 256 separate
// segments, and it came out as a string of beads. Bloom then smeared each bead outward and the
// centre of the galaxy wore a ring of roughly twenty radial spokes — a cog wheel, plainly visible
// in every wide screenshot, and it took three wrong guesses to find because it looks like noise
// aliasing and is not.
//
// Drawn as a field instead. The line has a floor in SCREEN space: whatever the distance, it is at
// least a pixel and a half wide, so it thins as you approach and never falls through the sampling
// grid. Gaussian rather than a hard band, because a hairline with hard edges aliases the moment it
// is not axis-aligned — which, being a circle, it never is.

export const PHOTON_RING_FRAGMENT = /* glsl */ `
  varying vec2 vLocal;

  uniform float uRadius;
  uniform float uThickness;
  uniform float uIntensity;
  uniform vec3 uColour;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    float r = length(vLocal);
    // fwidth(r) is world units per pixel. The 1.5 keeps the line above the Nyquist limit at any
    // distance; the max means it is the shader, not the geometry, that decides how thin is too thin.
    float width = max(uThickness, fwidth(r) * 1.5);
    float d = (r - uRadius) / width;
    float line = exp(-d * d * 2.0);

    gl_FragColor = vec4(uColour * line * uIntensity, line);

    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// A camera-facing hemisphere laid over the capture disc. The centre contributes almost no light,
// so the event horizon remains true black; only the grazing angles are visible. A cool fill keeps
// the receding right edge present while the warm key on the left ties the volume to the beamed disk.
// This is deliberately separate from the photon ring: the ring is a lensing hairline, while this
// broad, shaded shoulder is what makes the shadow read as a three-dimensional body.
export const SHADOW_VOLUME_FRAGMENT = /* glsl */ `
  varying vec2 vLocal;

  uniform float uRadius;
  uniform vec3 uWarm;
  uniform vec3 uCool;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    vec2 p = vLocal / uRadius;
    float r = length(p);
    if (r > 1.0) discard;

    // Reconstruct the camera-facing hemisphere normal from the circular image.
    float nz = sqrt(max(0.0, 1.0 - r * r));
    float fresnel = pow(1.0 - nz, 3.2);
    float shoulder = smoothstep(0.62, 0.985, r);

    // The accretion disk is brighter on screen-left. Keep that physical asymmetry, but give the
    // far side a real minimum so the horizon never collapses into a one-sided crescent.
    float key = clamp(0.52 - p.x * 0.38 + p.y * 0.08, 0.14, 0.94);
    vec3 colour = mix(uCool, uWarm, key);
    float strength = fresnel * shoulder * (0.13 + key * 0.42);

    gl_FragColor = vec4(colour * strength, strength * 0.92);

    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
