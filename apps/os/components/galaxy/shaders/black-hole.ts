// Stylized lens image, composited in one pass with premultiplied emission.
// The black shadow occludes stars; the near disk remains visible across its lower face.
export const BLACK_HOLE_FRAGMENT = /* glsl */ `
  varying vec2 vLocal;
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uDiskNormal;
  #include <common>
  #include <logdepthbuf_pars_fragment>

  float gaussian(float d, float width) {
    return exp(-d * d / (width * width));
  }

  void main() {
    vec2 p = vLocal / uRadius;
    // Project a fixed world-space disk normal into the current camera view.
    // The shadow remains circular while the disk turns and foreshortens during orbit.
    vec2 up = uDiskNormal.xy / max(length(uDiskNormal.xy), 0.001);
    if (length(uDiskNormal.xy) < 0.001) up = vec2(0.0, 1.0);
    p = vec2(dot(p, vec2(up.y, -up.x)), dot(p, up));
    float inclination = max(abs(uDiskNormal.z), 0.12);
    float r = length(p);
    float pixel = max(fwidth(r), 0.002);
    float outside = smoothstep(1.0 - pixel, 1.0 + pixel, r);
    float shadow = 1.0 - outside;

    // Foreshortened plane; its near half crosses in front of the shadow.
    vec2 diskP = vec2(p.x, p.y / inclination);
    float diskR = length(diskP);
    float angle = atan(diskP.y, diskP.x);
    float inner = smoothstep(1.15, 1.40, diskR);
    // Compact shoulders fade before they compete with the surrounding starfield.
    float outer = 1.0 - smoothstep(1.65, 2.55, diskR);
    float profile = inner * outer * exp(-max(diskR - 1.4, 0.0) * 1.65);
    float phase = angle + uTime * 0.32 / pow(max(diskR, 1.0), 1.5);
    float frequency = diskR * 48.0 + 2.2 * sin(phase * 3.0);
    float detail = 1.0 - smoothstep(0.8, 2.5, fwidth(frequency));
    float threads = 0.90 + 0.10 * sin(frequency) * detail;
    threads *= 0.92 + 0.08 * sin(phase * 4.0 + diskR * 8.0);
    float beam = 1.0 - 0.28 * p.x / max(diskR, 1.0);
    float front = 1.0 - smoothstep(-0.025, 0.025, p.y);
    float disk = profile * threads * beam * mix(outside, 1.0, front);

    // Compressed far-disk image joins the disk shoulders on both sides.
    float upper = smoothstep(-0.08, 0.38, p.y);
    float archR = length(vec2(p.x, p.y / (1.06 + inclination * 0.10)));
    float arch = gaussian(archR - 1.13, max(0.13, pixel)) * upper * outside;
    float sideLight = 0.86 - 0.28 * p.x / max(r, 0.01);

    vec3 amber = vec3(1.0, 0.48, 0.17);
    vec3 ivory = vec3(1.0, 0.86, 0.63);
    vec3 diskColour = mix(amber, ivory, exp(-max(diskR - 1.4, 0.0) * 1.5));
    vec3 emission = diskColour * disk * 1.20;
    // A warm underside beneath the near surface gives the disk visible thickness.
    float underR = length(vec2(p.x, (p.y + 0.055) / inclination));
    float underside = smoothstep(1.18, 1.40, underR) *
      (1.0 - smoothstep(1.65, 2.45, underR)) *
      exp(-max(underR - 1.4, 0.0) * 2.0) * front;
    emission += amber * underside * 0.24 * (1.0 - profile * 0.65);
    emission += mix(amber, ivory, 0.72) * arch * sideLight * 1.15;
    // No independent contour around the shadow: the visible boundary comes from the accretion disk
    // and upper lensing arch, so it reads as bent light instead of a shell pasted onto the core.
    // Only the shadow and accreting material occlude the starfield.
    // A broad circular dimming veil made the core look pasted over the galaxy.
    float opacity = max(shadow, disk * 0.65);
    gl_FragColor = vec4(emission, clamp(opacity, 0.0, 1.0));
    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
