// Opaque, smooth prospect spheres. View-space lighting keeps a readable curved surface even
// in the outer belt, where the client stars are too far away to illuminate these bodies.
export const PROSPECT_VERTEX = /* glsl */ `
  varying vec3 vSurfaceNormal;
  varying vec3 vViewPosition;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 localPosition = vec4(position, 1.0);
    vec3 localNormal = normal;
    #ifdef USE_INSTANCING
      localPosition = instanceMatrix * localPosition;
      localNormal = mat3(instanceMatrix) * localNormal;
    #endif
    vec4 mvPosition = modelViewMatrix * localPosition;
    vSurfaceNormal = normalize(normalMatrix * localNormal);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
  }
`;

export const PROSPECT_FRAGMENT = /* glsl */ `
  varying vec3 vSurfaceNormal;
  varying vec3 vViewPosition;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    vec3 n = normalize(vSurfaceNormal);
    vec3 view = normalize(vViewPosition);
    vec3 light = normalize(vec3(-0.65, 0.8, 0.9));
    float diffuse = max(dot(n, light), 0.0);
    float specular = pow(max(dot(n, normalize(light + view)), 0.0), 48.0);
    float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0);
    vec3 shadowAmethyst = vec3(0.045, 0.035, 0.07);
    vec3 smokyAmethyst = vec3(0.30, 0.24, 0.38);
    vec3 colour = mix(shadowAmethyst, smokyAmethyst, diffuse * diffuse);
    colour += vec3(0.72, 0.68, 0.80) * specular * 0.58;
    colour += vec3(0.24, 0.16, 0.27) * rim * 0.28;
    gl_FragColor = vec4(colour, 1.0);
    #include <logdepthbuf_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
