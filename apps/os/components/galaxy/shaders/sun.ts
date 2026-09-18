// Surface granulation and limb darkening keep a client sun readable when approached.
export const SUN_VERTEX = /* glsl */ `
  varying vec3 vSurface;
  varying vec3 vNormal;
  varying vec3 vView;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vSurface = normal;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;
export const SUN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying vec3 vSurface;
  varying vec3 vNormal;
  varying vec3 vView;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    vec3 p = vSurface;
    float granules = sin(p.x * 53.0 + sin(p.y * 31.0) + uTime)
                   * sin(p.y * 47.0 + sin(p.z * 37.0) - uTime * 0.7);
    float field = sin(p.z * 12.0 + p.x * 8.0 + sin(p.y * 17.0));
    float heat = clamp(0.65 + field * 0.13 + granules * 0.17, 0.0, 1.0);
    float limb = pow(max(dot(normalize(vNormal), normalize(vView)), 0.0), 0.35);
    vec3 colour = mix(vec3(0.72, 0.16, 0.015), vec3(1.6, 1.0, 0.35), heat);
    gl_FragColor = vec4(colour * (0.65 + limb * 0.8), 1.0);
    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
