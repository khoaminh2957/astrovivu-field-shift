/**
 * Star field behind the globe: one draw call of GL points on a celestial sphere that turns with
 * the camera, so the sky drifts as the globe rotates instead of sitting still like wallpaper.
 * MapLibre has no stars of its own; its canvas is transparent outside the globe, and this layer
 * is the first thing drawn into it.
 */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from 'maplibre-gl';
import { identity, rotateX, rotateY, rotateZ } from './mat4';

const STAR_COUNT = 2600;
/** Stars fade out between these zooms: below the globe fills the frame, above we are in the air. */
const FADE_START_ZOOM = 4.4;
const FADE_END_ZOOM = 6.2;

const VERTEX = `#version 300 es
layout(location = 0) in vec3 a_dir;
layout(location = 1) in vec4 a_look; // rgb tint, size in css px
uniform mat4 u_matrix;
uniform float u_pixel_ratio;
out vec3 v_tint;
void main() {
  vec4 p = u_matrix * vec4(a_dir, 0.0);
  // Directions sit at infinity, past the far plane: pin depth just inside it instead.
  gl_Position = vec4(p.xy, p.w * 0.999, p.w);
  gl_PointSize = a_look.a * u_pixel_ratio;
  v_tint = a_look.rgb;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 v_tint;
uniform float u_alpha;
out vec4 fragColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a * u_alpha;
  fragColor = vec4(v_tint * a, a); // premultiplied, as MapLibre blends
}`;

/** Deterministic PRNG: the sky is the same on every load and in every screenshot. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStars(): Float32Array {
  const rand = mulberry32(20261114);
  const data = new Float32Array(STAR_COUNT * 7);
  // A third of the stars crowd a tilted great circle: a hint of the galactic plane.
  const tilt = 1.05;
  for (let i = 0; i < STAR_COUNT; i++) {
    let x: number;
    let y: number;
    let z: number;
    if (i % 3 === 0) {
      const lon = rand() * 2 * Math.PI;
      const lat = (rand() + rand() + rand() - 1.5) * 0.28;
      const cx = Math.cos(lat) * Math.cos(lon);
      const cy = Math.sin(lat);
      const cz = Math.cos(lat) * Math.sin(lon);
      x = cx;
      y = cy * Math.cos(tilt) - cz * Math.sin(tilt);
      z = cy * Math.sin(tilt) + cz * Math.cos(tilt);
    } else {
      const u = rand() * 2 - 1;
      const phi = rand() * 2 * Math.PI;
      const r = Math.sqrt(1 - u * u);
      x = r * Math.cos(phi);
      y = u;
      z = r * Math.sin(phi);
    }
    // Many faint, few bright: brightness falls off steeply, like real magnitudes.
    const m = rand() ** 3.2;
    const brightness = 0.28 + 0.72 * m;
    const size = 1.1 + 2.3 * m;
    // Colour temperature: mostly white, some blue-white, a few warm.
    const k = rand();
    const tint = k < 0.62 ? [1, 1, 1] : k < 0.86 ? [0.8, 0.88, 1] : [1, 0.88, 0.74];
    data.set([x, y, z, tint[0] * brightness, tint[1] * brightness, tint[2] * brightness, size], i * 7);
  }
  return data;
}

export function createStarsLayer(id: string): CustomLayerInterface {
  let map: MapLibreMap | null = null;
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let buffer: WebGLBuffer | null = null;
  let uMatrix: WebGLUniformLocation | null = null;
  let uAlpha: WebGLUniformLocation | null = null;
  let uPixelRatio: WebGLUniformLocation | null = null;
  const view = identity();
  const matrix32 = new Float32Array(16);

  const compile = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('[globe] star shader:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const build = (gl: WebGL2RenderingContext) => {
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return;
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[globe] star program:', gl.getProgramInfoLog(program));
      program = null;
      return;
    }
    uMatrix = gl.getUniformLocation(program, 'u_matrix');
    uAlpha = gl.getUniformLocation(program, 'u_alpha');
    uPixelRatio = gl.getUniformLocation(program, 'u_pixel_ratio');
    vao = gl.createVertexArray();
    buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, buildStars(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  };

  // A restored context has lost every GL object; rebuild rather than draw with dead handles.
  const onRestored = () => {
    const gl = map?.getCanvas().getContext('webgl2');
    if (gl) build(gl);
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
      if (buffer) gl.deleteBuffer(buffer);
      if (vao) gl.deleteVertexArray(vao);
      program = null;
      map = null;
    },
    render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
      if (!map || !program || !vao) return;
      const zoom = map.getZoom();
      if (zoom >= FADE_END_ZOOM) return;
      const alpha = zoom <= FADE_START_ZOOM ? 1 : 1 - (zoom - FADE_START_ZOOM) / (FADE_END_ZOOM - FADE_START_ZOOM);

      // The rotation MapLibre applies to its globe, without the translations: stars are infinitely far.
      const center = map.getCenter();
      const rad = Math.PI / 180;
      view.set(input.projectionMatrix as ArrayLike<number>);
      rotateZ(view, view, map.getRoll() * rad);
      rotateX(view, view, -map.getPitch() * rad);
      rotateZ(view, view, map.getBearing() * rad);
      rotateX(view, view, center.lat * rad);
      rotateY(view, view, -center.lng * rad);
      matrix32.set(view);

      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(uMatrix, false, matrix32);
      gl.uniform1f(uAlpha, alpha);
      gl.uniform1f(uPixelRatio, gl.drawingBufferHeight / Math.max(1, map.getCanvas().clientHeight));
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, STAR_COUNT);
      gl.bindVertexArray(null);
    },
  };
}
