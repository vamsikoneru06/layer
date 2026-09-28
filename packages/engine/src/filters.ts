import { defaultFilters, type Filters } from "@vash/schema";

export type FilterValues = Omit<Filters, "preset">;
export const FILTER_KEYS = ["brightness", "contrast", "saturation", "warmth", "tint", "highlights", "shadows", "vignette", "grain", "blur", "sharpen"] as const;

/** Presets are parameter sets; picking one replaces every value. Keys match the schema's preset pattern. */
export const FILTER_PRESETS: readonly { key: string; label: string; values: Partial<FilterValues> }[] = [
  { key: "warm", label: "Warm", values: { warmth: 0.35, saturation: 0.1, contrast: 0.05 } },
  { key: "cool", label: "Cool", values: { warmth: -0.35, tint: -0.05, contrast: 0.05 } },
  { key: "vivid", label: "Vivid", values: { saturation: 0.45, contrast: 0.2, highlights: -0.1 } },
  { key: "fade", label: "Fade", values: { contrast: -0.3, shadows: 0.35, saturation: -0.15 } },
  { key: "mono", label: "Mono", values: { saturation: -1, contrast: 0.15 } },
  { key: "noir", label: "Noir", values: { saturation: -1, contrast: 0.45, shadows: -0.2, vignette: 0.45 } },
  { key: "film", label: "Film", values: { warmth: 0.12, contrast: -0.12, shadows: 0.2, grain: 0.35, vignette: 0.2 } },
];

export function presetFilters(key: string | null): Filters {
  const preset = FILTER_PRESETS.find((p) => p.key === key);
  return preset ? { ...defaultFilters(), ...preset.values, preset: preset.key } : defaultFilters();
}

/** True when the filters leave the photo untouched, so rendering can skip them. */
export const isNeutral = (f: Filters): boolean => FILTER_KEYS.every((k) => f[k] === 0);

const filterHash = (f: Filters) => FILTER_KEYS.map((k) => f[k].toFixed(3)).join(",");

/** The part of the photo a frame shows, as [left, top, right, bottom] fractions of the photo. */
export type VisibleBox = readonly [number, number, number, number];

/**
 * Returns the photo with `filters` applied at `width`×`height` px, or null when filtering isn't possible
 * (no WebGL2, or the context is lost) and the caller should draw the photo unfiltered. The vignette is
 * centred on `visible`, the part of the photo its frame shows (default: the whole photo).
 */
export type FilterFn = (source: CanvasImageSource, width: number, height: number, filters: Filters, visible?: VisibleBox) => CanvasImageSource | null;

const VERTEX = `#version 300 es
out vec2 v_uv;
void main() {
  // One triangle that covers the viewport.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Separable Gaussian: run once horizontally, once vertically. */
const BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_step;   // one texel along the blur direction
uniform float u_sigma; // in texels
in vec2 v_uv;
out vec4 o;
void main() {
  // 25 taps spread to cover ±3 sigma.
  float spacing = max(1.0, 3.0 * u_sigma / 12.0);
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -12; i <= 12; i++) {
    float x = float(i) * spacing;
    float w = exp(-(x * x) / (2.0 * u_sigma * u_sigma));
    sum += texture(u_tex, v_uv + u_step * x) * w;
    total += w;
  }
  o = sum / total;
}`;

/** Colour adjustments, unsharp mask, vignette and grain in one pass. */
const UBER = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_soft;
uniform float u_sharpen, u_brightness, u_contrast, u_saturation, u_warmth, u_tint, u_highlights, u_shadows, u_vignette, u_grain;
uniform vec2 u_aspect;
uniform vec2 u_size;
uniform vec4 u_box;
uniform bool u_flip;
in vec2 v_uv;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = u_flip ? vec2(v_uv.x, 1.0 - v_uv.y) : v_uv;
  vec4 src = texture(u_tex, uv);
  vec3 c = src.rgb;
  if (u_sharpen > 0.0) c += (c - texture(u_soft, uv).rgb) * u_sharpen * 2.0;

  c += u_brightness * 0.25;
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += u_highlights * 0.25 * smoothstep(0.5, 1.0, luma);
  c += u_shadows * 0.25 * (1.0 - smoothstep(0.0, 0.5, luma));
  luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.0 + u_saturation);
  c += vec3(u_warmth * 0.1 + u_tint * 0.05, -u_tint * 0.1, -u_warmth * 0.1 + u_tint * 0.05);

  if (u_vignette > 0.0) {
    // Centred on the part of the photo the frame shows, and round in that box's proportions.
    vec2 box = (u_box.zw - u_box.xy) * u_size;
    vec2 p = (uv - u_box.xy) / (u_box.zw - u_box.xy);
    float d = length((p - 0.5) * box / max(box.x, box.y)) * 1.414;
    c *= 1.0 - u_vignette * smoothstep(0.35, 1.0, d);
  }
  // Grain is tied to the photo, not to pixels, so the preview and a 3x export look alike.
  if (u_grain > 0.0) c += (hash(floor(uv * u_aspect * 700.0)) - 0.5) * u_grain * 0.2;

  o = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

interface Gl {
  gl: WebGL2RenderingContext;
  blur: WebGLProgram;
  uber: WebGLProgram;
  source: WebGLTexture;
  targets: Target[];
  size: { width: number; height: number };
}

function compile(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, text] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`filter shader: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`filter program: ${gl.getProgramInfoLog(program)}`);
  return program;
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const [p, v] of [
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ] as const) {
    gl.texParameteri(gl.TEXTURE_2D, p, v);
  }
  return tex;
}

const WHOLE: VisibleBox = [0, 0, 1, 1];

/** Most filtered versions kept per photo: the current one and the one before it (e.g. during a slider drag). */
const PER_SOURCE = 2;

/**
 * WebGL2 filter pipeline on its own canvas. Results are copied into small 2D canvases cached per
 * (photo, filter values, size), so an unchanged photo is never filtered twice. Survives context loss:
 * cached results stay valid, and new work resumes when the browser restores the context.
 */
export function createFilterRenderer(o: { onRestored?: () => void } = {}): { apply: FilterFn; readonly available: boolean; destroy(): void } {
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
  const scratch: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
  let state: Gl | null = null;
  let lost = false;
  const cache = new WeakMap<object, { key: string; out: HTMLCanvasElement | OffscreenCanvas }[]>();

  const init = (): Gl | null => {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, depth: false }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    try {
      return { gl, blur: compile(gl, BLUR), uber: compile(gl, UBER), source: texture(gl), targets: [], size: { width: 0, height: 0 } };
    } catch {
      return null;
    }
  };
  state = init();

  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    state = null;
  };
  const onRestored = () => {
    lost = false;
    state = init();
    o.onRestored?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const targets = (s: Gl, width: number, height: number): Target[] => {
    if (s.size.width === width && s.size.height === height && s.targets.length) return s.targets;
    const { gl } = s;
    for (const t of s.targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    s.targets = [0, 1, 2].map(() => {
      const tex = texture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    });
    s.size = { width, height };
    return s.targets;
  };

  const blur = (s: Gl, from: WebGLTexture, via: Target, to: Target, sigma: number) => {
    const { gl } = s;
    gl.useProgram(s.blur);
    gl.uniform1f(gl.getUniformLocation(s.blur, "u_sigma"), sigma);
    const step = gl.getUniformLocation(s.blur, "u_step");
    for (const [input, output, dir] of [
      [from, via, [1 / s.size.width, 0]],
      [via.tex, to, [0, 1 / s.size.height]],
    ] as const) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.uniform2f(step, dir[0], dir[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  };

  const run = (s: Gl, source: CanvasImageSource, width: number, height: number, f: Filters, visible: VisibleBox) => {
    const { gl } = s;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    const [a, b, c] = targets(s, width, height) as [Target, Target, Target];

    // Scale the photo to the target size with the browser's high-quality resampling first; GL's LINEAR
    // sampling alone would shimmer when shrinking a large photo.
    scratch.width = width;
    scratch.height = height;
    const sctx = scratch.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(source, 0, 0, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch as TexImageSource);

    // Blur and sharpen radii are relative to the photo, so previews and exports match.
    const side = Math.max(width, height);
    let base: WebGLTexture = s.source;
    if (f.blur > 0) {
      blur(s, base, a, b, Math.max(0.5, f.blur * 0.012 * side));
      base = b.tex;
    }
    let soft: WebGLTexture = base;
    if (f.sharpen > 0) {
      blur(s, base, a, c, Math.max(1, 0.0015 * side));
      soft = c.tex;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(s.uber);
    const u = (name: string) => gl.getUniformLocation(s.uber, name);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, base);
    gl.uniform1i(u("u_tex"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, soft);
    gl.uniform1i(u("u_soft"), 1);
    for (const k of ["sharpen", "brightness", "contrast", "saturation", "warmth", "tint", "highlights", "shadows", "vignette", "grain"] as const) {
      gl.uniform1f(u(`u_${k}`), f[k]);
    }
    gl.uniform2f(u("u_aspect"), width / side, height / side);
    gl.uniform2f(u("u_size"), width, height);
    gl.uniform4f(u("u_box"), ...visible);
    // Textures hold the photo top row first; the canvas's first row is GL's last, so the final pass flips.
    gl.uniform1i(u("u_flip"), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const apply: FilterFn = (source, width, height, f, visible = WHOLE) => {
    if (lost || !state || width < 1 || height < 1) return null;
    // Where the frame sits only matters with a vignette; leaving it out otherwise keeps panning a photo cheap.
    const box = f.vignette > 0 ? `:${visible.map((v) => v.toFixed(3)).join(",")}` : "";
    const key = `${width}x${height}:${filterHash(f)}${box}`;
    const entries = cache.get(source as object) ?? [];
    const hit = entries.find((e) => e.key === key);
    if (hit) return hit.out;

    run(state, source, width, height, f, visible);
    // Reuse the oldest result's canvas once the per-photo limit is reached.
    const reused = entries.length >= PER_SOURCE ? entries.shift()!.out : null;
    const out = reused ?? (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height }));
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    ctx.drawImage(canvas, 0, 0);
    entries.push({ key, out });
    cache.set(source as object, entries);
    return out;
  };

  return {
    apply,
    get available() {
      return state !== null && !lost;
    },
    destroy() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      state?.gl.getExtension("WEBGL_lose_context")?.loseContext();
      state = null;
    },
  };
}
