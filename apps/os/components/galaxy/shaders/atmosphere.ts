// Local emission only: outside each cloud the contribution is exactly zero.
export const ATMOSPHERE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    if (r >= 1.0) discard;
    float wisps = 0.72 + 0.16 * sin(p.x * 13.0 + sin(p.y * 9.0))
                       + 0.12 * sin(p.y * 21.0 + p.x * 7.0);
    float density = exp(-r * r * 7.0) * smoothstep(1.0, 0.35, r) * wisps;
    gl_FragColor = vec4(vColor, density * vAlpha);
    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
