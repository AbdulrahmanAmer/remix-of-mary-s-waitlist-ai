/**
 * One WebGL context and one compiled shader for the whole page. The single canvas
 * is moved (not copied) into whichever orb is on screen, so screens never
 * recompile and no frame is ever read back to the CPU. The compile runs off the
 * main thread where KHR_parallel_shader_compile exists: on Windows a blocking
 * compile froze the page for over a second per orb.
 */

import { isSoftwareRenderer } from "./orb-pace";

const VERTEX = "attribute vec2 a; varying vec2 uv; void main(){ uv=a; gl_Position=vec4(a,0.,1.); }";

// The approved "H" orb: a round form with lime and cobalt light moving through white
// mist, a soft rim glow and a ground shadow. Premultiplied alpha, so it sits on the
// cream paper without a box.
const FRAGMENT = `
precision highp float;
varying vec2 uv;
uniform float t, lv, sw, bloom;
float h(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s; }
vec3 A=vec3(0.84,0.92,0.52), B=vec3(0.36,0.43,0.91), C=vec3(0.99,1.0,0.95);
void main(){
  vec2 q=uv*1.2;
  float R=0.6*(1.+0.07*lv+0.035*bloom+0.01*sin(t*1.3));
  float r=length(q);
  vec4 col=vec4(0.);
  float glow=exp(-max(r-R,0.)*9.)*(0.08+0.18*lv+0.12*bloom)*step(R,r);
  col+=vec4(B*glow,glow);
  if(r<R+0.004){
    vec2 p=q/R;
    float ang=t*(0.12+0.55*sw);
    p=mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*p;
    vec3 d=vec3(p*1.4,t*0.12);
    float w=fbm(d+vec3(fbm(d*1.2+t*0.08),fbm(d*1.1-t*0.07),0.)*1.6);
    float sky=smoothstep(-1.,1.,-p.y*0.9+(w-0.5)*1.4);
    vec3 c3=mix(mix(B,A,sky),C,smoothstep(0.52,0.86,w+0.12*lv)*0.85);
    c3*=0.9+0.1*dot(normalize(vec3(p,sqrt(max(0.,1.-dot(p,p))))),normalize(vec3(-0.4,0.6,0.7)));
    float a=smoothstep(R+0.004,R-0.004,r);
    col=vec4(c3*a,a)+col*(1.-a);
  }
  vec2 s=(uv*1.2-vec2(0.,-0.82))*vec2(1.,5.);
  float sh=exp(-dot(s,s)*7.)*0.09;
  col+=vec4(vec3(0.09,0.1,0.08)*sh,sh)*(1.-col.a);
  gl_FragColor=col;
}`;

export type OrbGpu = {
  /** The one visible WebGL canvas; the active orb holds it in its box. */
  canvas: HTMLCanvasElement;
  /** True once the shader is compiled and linked (never blocks where the extension exists). */
  ready: () => boolean;
  /** Draws a frame at the given pixel size. */
  draw: (w: number, h: number, t: number, lv: number, sw: number, bloom: number) => void;
  /** Newest orb wins: returns a token; only the holder of the latest token draws. */
  claim: () => number;
  owns: (token: number) => boolean;
  /** WebGL is being emulated on the CPU (SwiftShader, llvmpipe): draw less, and smaller. */
  software: boolean;
};

let shared: OrbGpu | null | undefined;

export function orbGpu(): OrbGpu | null {
  if (shared !== undefined) return shared;
  shared = null;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  canvas.setAttribute("aria-hidden", "true");
  // The shader smooths its own edge, so multisampling would only cost fill rate;
  // low-power keeps a dual-GPU laptop on its integrated chip for one soft ball.
  const gl = canvas.getContext("webgl", {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;
  const software = isSoftwareRenderer(rendererName(gl));
  const parallel = gl.getExtension("KHR_parallel_shader_compile") as {
    COMPLETION_STATUS_KHR: number;
  } | null;
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.shaderSource(vs, VERTEX);
  gl.shaderSource(fs, FRAGMENT);
  gl.compileShader(vs);
  gl.compileShader(fs);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  let status: "pending" | "ok" | "failed" = "pending";
  let loc = 0;
  let uT: WebGLUniformLocation | null = null;
  let uLv: WebGLUniformLocation | null = null;
  let uSw: WebGLUniformLocation | null = null;
  let uBloom: WebGLUniformLocation | null = null;
  let token = 0;

  const ready = () => {
    if (status !== "pending") return status === "ok";
    // Without the extension this call blocks until the link is done.
    if (parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      status = "failed";
      return false;
    }
    status = "ok";
    loc = gl.getAttribLocation(program, "a");
    uT = gl.getUniformLocation(program, "t");
    uLv = gl.getUniformLocation(program, "lv");
    uSw = gl.getUniformLocation(program, "sw");
    uBloom = gl.getUniformLocation(program, "bloom");
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  };

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    status = "failed";
  });

  shared = {
    canvas,
    ready,
    draw(w, h, t, lv, sw, bloom) {
      if (!ready()) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uT, t);
      gl.uniform1f(uLv, lv);
      gl.uniform1f(uSw, sw);
      gl.uniform1f(uBloom, bloom);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    claim: () => ++token,
    owns: (held) => held === token,
    software,
  };
  return shared;
}

/** The GPU (or CPU emulation) behind the context, where the browser will say. */
function rendererName(gl: WebGLRenderingContext): string {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info") as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const unmasked = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
    return String(unmasked ?? gl.getParameter(gl.RENDERER) ?? "");
  } catch {
    return "";
  }
}

/** Start compiling as early as possible, before the first orb is on screen. */
export function warmOrb() {
  orbGpu()?.ready();
}
