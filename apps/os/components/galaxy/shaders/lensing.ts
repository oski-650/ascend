// components/galaxy/shaders/lensing — GRAVITATIONAL LENSING, IN SCREEN SPACE (brief §7.5).
//
// ─── WHAT IT ACTUALLY DOES, AND WHY IT IS NOT A FISHEYE ────────────────────────────────────────
//
// Light passing near the hole is deflected towards it. So the image of anything near the shadow —
// the starfield, the bulge, the far arm — appears pulled inward and stretched around it. This pass
// reproduces that by sampling the already-rendered frame at coordinates displaced towards the
// hole's screen position, with a deflection that falls as 1/r².
//
// It is DELIBERATELY subtle. Turned up it looks like a lens sitting in front of the monitor, which
// is the opposite of the intent: what should read is that space near the core is bent, not that the
// picture has been distorted. §7 gives 0.035, and at that strength nobody can name the effect and
// everybody notices when it is removed.
//
// ─── THE TWO CLAMPS ARE LOAD-BEARING ───────────────────────────────────────────────────────────
//
// 1/r² diverges. Without the falloff the entire frame is dragged towards the core and the corners
// smear; without the cap the shader samples from the far side of the buffer and the hole is
// surrounded by a smeared copy of the galaxy. Both are asserted against the pure profile in
// `graph-view/field/blackhole`, which this shader mirrors exactly.
//
// Nothing is ever deflected INTO the shadow. That is both the physics — an image there would be
// light arriving from a direction no light comes from — and the fix for the first version, which
// dragged the photon ring a fifth of the way inside the black disc and clipped it into a sliver.

export const LENSING_FRAGMENT = /* glsl */ `
  uniform vec2 uCentre;    // hole's screen position, in UV
  uniform float uRadius;   // shadow's screen radius, in half-height units
  uniform float uStrength;
  uniform float uFalloff;
  uniform float uAspect;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // Work in a square space so the deflection is radial on screen rather than elliptical.
    vec2 d = uv - uCentre;
    d.x *= uAspect;
    float r = length(d);

    if (r < 1e-5 || uRadius <= 0.0) {
      outputColor = inputColor;
      return;
    }

    float k = uStrength * uRadius * uRadius / max(r * r, 1e-5);

    // Gone by the falloff radius, so the corners of the frame are untouched.
    float outer = uRadius * uFalloff;
    float inner = uRadius * 1.2;
    float t = clamp((outer - r) / max(outer - inner, 1e-5), 0.0, 1.0);
    float eased = t * t * (3.0 - 2.0 * t);

    // Never displace further than the distance being displaced, and never INTO the shadow — the
    // deflection peaks exactly where the photon ring is, and without the second clamp the pass
    // drags the ring inward past the black disc and clips it into a broken sliver. It is also the
    // physics: an image inside the shadow would be light arriving from where none does.
    //
    // The clamp also removes the need to paint the shadow black here. Inside it the second term is
    // zero, so the pass samples the pixel it was handed, which the scene already drew black.
    // Preserve a slope at the rim: clamping directly to the radius repeats the same bright
    // ring sample across an entire annulus, turning a hairline into a thick white band.
    float amount = min(min(k * eased, r), max(r - uRadius, 0.0) * 0.18);

    vec2 warped = uv - normalize(d) * amount * vec2(1.0 / uAspect, 1.0);
    outputColor = texture2D(inputBuffer, warped);
  }
`;
