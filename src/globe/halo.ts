/**
 * Atmosphere seen from orbit: a soft glow outside the limb, a thin haze just inside it and a
 * gentle fall-off of light away from the sun, which is what makes a textured disc read as a
 * lit sphere.
 *
 * MapLibre's own atmosphere is a physical scattering model. It is kept, at low strength, for
 * the blue line on the horizon, but on its own it either veils the whole disc in white (sun
 * behind the camera) or cuts it with a hard terminator (sun to the side), over imagery that is
 * lit evenly everywhere. This layer is the art direction on top: one full-screen triangle, a ray
 * per pixel against the unit sphere, no textures and no loops.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { identity, invert, rotateX, rotateY, rotateZ } from './mat4';

/** The glow belongs to the view from space: gone by the time the limb leaves the frame. */
const FADE_START_ZOOM = 3.8;
const FADE_END_ZOOM = 6.4;

const VERTEX = `#version 300 es
uniform vec3 u_origin[3];
uniform vec3 u_ray[3];
out vec3 v_origin;
out vec3 v_ray;
void main() {
  // One oversized triangle covers the screen; rays are affine in screen space, so three suffice.
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  v_origin = u_origin[gl_VertexID];
  v_ray = u_ray[gl_VertexID];
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 v_origin;
in vec3 v_ray;
uniform vec3 u_sun;
uniform float u_strength;
out vec4 fragColor;

void main() {
  vec3 d = normalize(v_ray);
  float along = -dot(v_origin, d);
  vec3 nearest = v_origin + d * along;
  float r = length(nearest);          // 1.0 is the limb of the unit sphere
  vec3 rgb = vec3(0.0);
  float a = 0.0;

  if (r >= 1.0) {
    // Outside: a bright thin shell and a wide faint one, both stronger toward the sun.
    float h = r - 1.0;
    float lit = mix(0.42, 1.0, smoothstep(-0.55, 0.65, dot(nearest / r, u_sun)));
    float shell = exp(-h / 0.011);
    float bloom = exp(-h / 0.1);
    a = (0.62 * shell + 0.32 * bloom) * lit;
    rgb = mix(vec3(0.20, 0.47, 1.0), vec3(0.72, 0.89, 1.0), shell) * a;
  } else {
    // On the disc: haze thickens toward the edge, and the side away from the sun falls into shade.
    vec3 n = v_origin + d * (along - sqrt(1.0 - r * r));
    float facing = clamp(dot(n, -d), 0.0, 1.0);
    float sun = dot(n, u_sun);
    float lit = mix(0.42, 1.0, smoothstep(-0.55, 0.65, sun));
    float haze = pow(1.0 - facing, 3.2) * 0.72 * lit;
    float shade = smoothstep(0.42, -0.5, sun) * 0.46;
    vec3 hazeColor = mix(vec3(0.30, 0.58, 1.0), vec3(0.80, 0.92, 1.0), pow(1.0 - facing, 6.0));
    // Shade first, haze over it: the atmosphere still catches light where the ground is dim.
    a = haze + shade * (1.0 - haze);
    rgb = hazeColor * haze + vec3(0.004, 0.010, 0.028) * shade * (1.0 - haze);
  }
  fragColor = vec4(rgb, a) * u_strength; // premultiplied
}`;

/** Where the sun sits relative to the viewer: up, to the left, and a little behind the camera. */
const SUN_VIEW: [number, number, number] = [-0.58, 0.5, 0.64];

export function createHaloLayer(id: string): CustomLayerInterface {
  let map: MapLibreMap | null = null;
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let uOrigin: WebGLUniformLocation | null = null;
  let uRay: WebGLUniformLocation | null = null;
  let uSun: WebGLUniformLocation | null = null;
  let uStrength: WebGLUniformLocation | null = null;
  const inverse = identity();
  const rotation = identity();
  const origins = new Float32Array(9);
  const rays = new Float32Array(9);
  const corners: [number, number][] = [
    [-1, -1],
    [3, -1],
    [-1, 3],
  ];

  const build = (gl: WebGL2RenderingContext) => {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('[globe] halo shader:', gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return;
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[globe] halo program:', gl.getProgramInfoLog(program));
      program = null;
      return;
    }
    uOrigin = gl.getUniformLocation(program, 'u_origin');
    uRay = gl.getUniformLocation(program, 'u_ray');
    uSun = gl.getUniformLocation(program, 'u_sun');
    uStrength = gl.getUniformLocation(program, 'u_strength');
    // Attribute-less draw: WebGL 2 still wants a vertex array bound.
    vao = gl.createVertexArray();
  };

  const onRestored = () => {
    const gl = map?.getCanvas().getContext('webgl2');
    if (gl) build(gl);
  };

  /** Clip space to globe space (unit sphere at the origin), in doubles. */
  const unproject = (x: number, y: number, z: number): [number, number, number] => {
    const m = inverse;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
  };

  return {
    id,
    type: 'custom',
    renderingMode: '2d',
    onAdd(m, gl) {
      map = m;
      build(gl);
      m.on('webglcontextrestored', onRestored);
    },
    onRemove(m, gl) {
      m.off('webglcontextrestored', onRestored);
      if (program) gl.deleteProgram(program);
      if (vao) gl.deleteVertexArray(vao);
      program = null;
      map = null;
    },
    render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
      if (!map || !program || !vao) return;
      const zoom = map.getZoom();
      if (zoom >= FADE_END_ZOOM) return;
      // Only while MapLibre is fully in its globe projection is this matrix "unit sphere to clip".
      if (input.defaultProjectionData.projectionTransition < 1) return;
      if (!invert(inverse, input.modelViewProjectionMatrix as ArrayLike<number>)) return;
      const strength = zoom <= FADE_START_ZOOM ? 1 : 1 - (zoom - FADE_START_ZOOM) / (FADE_END_ZOOM - FADE_START_ZOOM);

      for (let i = 0; i < 3; i++) {
        const [x, y] = corners[i];
        const near = unproject(x, y, -1);
        const far = unproject(x, y, 1);
        origins.set(near, i * 3);
        rays.set([far[0] - near[0], far[1] - near[1], far[2] - near[2]], i * 3);
      }

      // Sun fixed to the screen, expressed in globe space: undo the rotation MapLibre applies.
      const rad = Math.PI / 180;
      const center = map.getCenter();
      rotation.set(identity());
      rotateZ(rotation, rotation, map.getRoll() * rad);
      rotateX(rotation, rotation, -map.getPitch() * rad);
      rotateZ(rotation, rotation, map.getBearing() * rad);
      rotateX(rotation, rotation, center.lat * rad);
      rotateY(rotation, rotation, -center.lng * rad);
      const [sx, sy, sz] = SUN_VIEW;
      const len = Math.hypot(sx, sy, sz);
      // Transpose of a rotation is its inverse: rows of the matrix are the view axes in globe space.
      const sun = [
        (rotation[0] * sx + rotation[1] * sy + rotation[2] * sz) / len,
        (rotation[4] * sx + rotation[5] * sy + rotation[6] * sz) / len,
        (rotation[8] * sx + rotation[9] * sy + rotation[10] * sz) / len,
      ];

      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform3fv(uOrigin, origins);
      gl.uniform3fv(uRay, rays);
      gl.uniform3f(uSun, sun[0], sun[1], sun[2]);
      gl.uniform1f(uStrength, strength);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
  };
}
