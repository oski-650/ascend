// components/galaxy/shaders/accretion — THE DISK, AND THE ARCS BENT OVER IT (brief §7.3, §7.4).
//
// One shader serves both, because they are the same material seen twice: the accretion disk as it
// lies, and the far side of it lifted over and under the hole by the lens. Sharing the shader is
// what makes the arcs read as the SAME disk rather than as two decorative rings — same colour ramp,
// same turbulence, same shear, dimmer and radially compressed.
//
// ─── THE FOUR THINGS HAPPENING HERE, AND WHY EACH IS NOT OPTIONAL ──────────────────────────────
//
// **Differential rotation.** Bands orbit Keplerian, so `speed ∝ r^-1.5`. The inner edge laps the
// rim roughly eight times over the disk's width, and the SHEAR between neighbours is what stretches
// the noise into filaments. Rotate the whole thing rigidly instead and it is a texture on a ring —
// visibly so, immediately.
//
// **Domain warping.** The second noise octave is sampled at coordinates displaced by the first.
// That is the difference between "noise" and "structure": undisplaced octaves add roughness at
// smaller scales, warped ones produce the curling, folding filaments that plasma actually has.
//
// **Doppler beaming.** `mix(0.3, 2.6, …)` across the azimuth. Matter here orbits at a serious
// fraction of light speed, so the side coming towards the viewer is beamed bright and the receding
// side is dimmed — a factor of eight and a half between the two edges. §7 names skipping this as
// the most common tell of a fake black hole. It depends on WHERE THE CAMERA IS, so the angle is a
// uniform recomputed as the view moves, not a constant baked into the texture.
//
// **The edges fade.** A disk with a hard inner or outer rim reads as geometry. Both taper.
//
// ─── THE NOISE IS COMPUTED, NOT SAMPLED ────────────────────────────────────────────────────────
//
// Simplex, inline. A texture would need a browser rasteriser, and F66 bans those after a canvas
// gradient's dithering turned into coloured specks around every bright body in Safari and nowhere
// else. Helpers are prefixed so they cannot collide with three's own chunks.

export const ACCRETION_VERTEX = /* glsl */ `
  varying vec2 vLocal;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    // RingGeometry lies in its own XY plane; the mesh's rotation puts that plane where it belongs.
    // Passing the LOCAL position means the shader reasons in disk coordinates no matter how the
    // mesh is oriented, which is what lets the arcs reuse it while facing the camera.
    vLocal = position.xy;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

export const ACCRETION_FRAGMENT = /* glsl */ `
  varying vec2 vLocal;

  uniform float uTime;
  uniform float uInner;
  uniform float uOuter;
  uniform float uSpeed;
  uniform float uFalloff;
  uniform float uApproachAngle;
  uniform float uBeamAway;
  uniform float uBeamToward;
  uniform float uIntensity;
  /** 0 draws the whole annulus, +1 keeps the upper arc, -1 the lower one. */
  uniform float uArcSide;
  uniform float uPlaneSide;

  uniform vec3 uRampInner;
  uniform vec3 uRampMid;
  uniform vec3 uRampOuter;
  uniform vec3 uRampRim;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  vec3 ac_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 ac_mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 ac_permute(vec3 x) { return ac_mod289(((x * 34.0) + 1.0) * x); }

  float ac_snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = ac_mod289(i);
    vec3 p = ac_permute(ac_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  /** Inner-to-rim colour, white-hot through to nothing. */
  vec3 ac_ramp(float t) {
    if (t < 0.22) return mix(uRampInner, uRampMid, t / 0.22);
    if (t < 0.58) return mix(uRampMid, uRampOuter, (t - 0.22) / 0.36);
    return mix(uRampOuter, uRampRim, (t - 0.58) / 0.42);
  }

  void main() {
    // Split the disk around the shadow, so foreground material can cross its lower rim.
    if (uPlaneSide > 0.5 && vLocal.y < 0.0) discard;
    if (uPlaneSide < -0.5 && vLocal.y >= 0.0) discard;
    float r = length(vLocal);
    float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
    float theta = atan(vLocal.y, vLocal.x);

    // Keplerian shear. Every band is at a different phase of the same noise field, and the
    // difference between neighbours is what stretches it into filaments.
    float band = uSpeed * pow(uInner / max(r, uInner), 1.5);
    float a = theta + band * uTime;

    // Two octaves, the second displaced by the first. Sampled in POLAR coordinates so the structure
    // wraps seamlessly around the annulus instead of tiling across it.
    float n1 = ac_snoise(vec2(a * 5.5, r * 0.16));
    float n2 = ac_snoise(vec2(a * 12.0 + n1 * 1.5, r * 0.34 - n1 * 0.9 + uTime * 0.04));

    // ─── ANTI-ALIASING, AND IT IS NOT OPTIONAL AT THE GALAXY VIEW ───────────────────────────
    //
    // Seen from the default camera the whole disk is about 90 pixels across, so each pixel spans a
    // large arc of the noise field and the octaves are badly undersampled. The result is not soft
    // noise — it is a fixed pattern of radial SPOKES, a cog wheel sitting at the centre of the
    // galaxy, and it is the first thing the eye finds in the wide shot.
    //
    // fwidth gives how much of each coordinate one pixel covers, so an octave can be faded out
    // exactly when it stops being resolvable. Undersampled, turbulence relaxes to its mean and the
    // disk reads as smooth plasma; close up, both octaves come back at full strength.
    float aStep = fwidth(a);
    float rStep = fwidth(r);
    float fade1 = 1.0 - smoothstep(0.3, 1.1, max(aStep * 5.5, rStep * 0.16));
    float fade2 = 1.0 - smoothstep(0.3, 1.1, max(aStep * 12.0, rStep * 0.34));

    // And a second fade on the disk's SCREEN SIZE, which is a different problem from resolvability.
    // At the galaxy view the disk is about ninety pixels across; its filaments are individually
    // resolvable there and still read as a cog wheel, because a dozen hard-edged wedges arranged in
    // a circle is a mechanism whatever its frequency. rStep is world units per pixel, so this fades
    // structure out as the object gets small and brings it back as it is approached — smooth ring
    // from across the galaxy, turbulent plasma up close.
    float detail = 1.0 - smoothstep(0.5, 2.2, rStep);

    // Contrast reduced from 0.45 to 0.4 as well: the filaments swung between a tenth and full
    // brightness, which is a bar chart rather than a fluid.
    float turbulence = 0.6 + 0.4 * detail * (0.62 * n1 * fade1 + 0.38 * n2 * fade2);
    turbulence = clamp(turbulence, 0.0, 1.6);

    // Radial falloff, steep. Normalised so the inner edge is 1.0 rather than enormous.
    float radial = pow(uInner / max(r, uInner), uFalloff);

    // Doppler beaming. The approach angle is where the camera is, not where the disk is.
    float beam = mix(uBeamAway, uBeamToward, 0.5 + 0.5 * cos(theta - uApproachAngle));

    // Both rims taper. A hard edge anywhere on this object reads as geometry.
    float edge = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.78, 1.0, t));

    // Arc masking, for the two bands lensed over and under the hole.
    float mask = 1.0;
    if (uArcSide > 0.5) mask = smoothstep(-0.1, 0.45, normalize(vLocal).y);
    else if (uArcSide < -0.5) mask = smoothstep(-0.1, 0.45, -normalize(vLocal).y);

    float amount = edge * mask * turbulence * radial * beam * uIntensity;
    vec3 colour = ac_ramp(t) * amount;

    gl_FragColor = vec4(colour, clamp(amount, 0.0, 1.0));

    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
