/**
 * The 3D coins, ported from the prototype (three.js r128 there; `three@0.128.0` from npm here so the
 * materials, lighting and tone mapping render identically). Client-only: components load this module
 * with a dynamic import inside an effect.
 *
 * - Coin: LatheGeometry rim (green chrome, metalness 1, roughness .2, reeded bump on the outer band),
 *   CircleGeometry faces with canvas textures (guilloche, ring text, emblem).
 * - Lighting: PMREM environment from a canvas "studio" equirect, key/rim/fill/ambient lights, ACES.
 * - Loop: one shared requestAnimationFrame; a scene renders only while on screen and the tab is visible.
 * - prefers-reduced-motion stops the idle sway/orbit; pointer and click still work.
 */
import { BRAND } from "../lib/brand";
import * as THREE from "three";
import { mulberry32 } from "@divvy/shared";

export interface StockArt {
  symbol: string;
  name: string;
  mono: string;
  bg: string;
  fg: string;
  /** The token's own icon (same origin); the face falls back to the initials without it. */
  logo?: string | null;
}

const FONT_D = "'Clash Display','Plus Jakarta Sans',system-ui,sans-serif";
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch {
    return false;
  }
}

/* ---------- canvas textures ---------- */

function hiCanvas(draw: (g: CanvasRenderingContext2D) => void, size = 1024): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.scale(size / 512, size / 512);
  draw(g);
  return c;
}

function ringText(g: CanvasRenderingContext2D, text: string, r: number, font: string, color: string) {
  g.save();
  g.font = font;
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const ch = [...text],
    st = (Math.PI * 2) / ch.length;
  ch.forEach((c, i) => {
    g.save();
    g.translate(256, 256);
    g.rotate(i * st);
    g.translate(0, -r);
    g.fillText(c, 0, 0);
    g.restore();
  });
  g.restore();
}

function guilloche(g: CanvasRenderingContext2D, col: string, r0 = 150) {
  g.save();
  g.strokeStyle = col;
  g.lineWidth = 1;
  for (let k = 0; k < 30; k++) {
    g.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.02; a += 0.025) {
      const rr = (r0 + 9 * Math.sin(a * 14 + k * 0.4)) * (0.5 + k * 0.014);
      const x = 256 + Math.cos(a) * rr,
        y = 256 + Math.sin(a) * rr;
      if (a) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  }
  g.restore();
}

function logoFace(): HTMLCanvasElement {
  return hiCanvas((g) => {
    const bg = g.createRadialGradient(180, 160, 30, 256, 256, 270);
    bg.addColorStop(0, "#1f5236");
    bg.addColorStop(0.65, "#0d2819");
    bg.addColorStop(1, "#06150d");
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 512);
    guilloche(g, "rgba(134,239,172,.08)");
    g.strokeStyle = "rgba(134,239,172,.6)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(256, 256, 236, 0, 7);
    g.stroke();
    g.strokeStyle = "rgba(134,239,172,.28)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(256, 256, 192, 0, 7);
    g.stroke();
    ringText(g, "MEMECOINS THAT PAY IN STOCKS ✦ NVDA ✦ SPY ✦ TSLA ✦ AAPL ✦ ", 214, `600 19px ${FONT_D}`, "rgba(200,255,224,.78)");
    const tg = g.createLinearGradient(200, 120, 330, 380);
    tg.addColorStop(0, "#E3FFEE");
    tg.addColorStop(0.45, "#4ADE80");
    tg.addColorStop(1, "#C5F56A");
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(74,222,128,.85)";
    g.shadowBlur = 40;
    g.fillStyle = tg;
    g.font = `700 230px ${FONT_D}`;
    g.fillText("$", 256, 236);
    g.shadowBlur = 0;
    g.fillStyle = "#DFFFEA";
    g.font = `600 46px ${FONT_D}`;
    g.fillText(BRAND, 256, 370);
  });
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

/** A stock coin's face: the token's icon with a gloss and a thin ring, or the initials face. */
async function stockFace(s: StockArt): Promise<HTMLCanvasElement> {
  const img = s.logo ? await loadImage(s.logo) : null;
  if (!img) return monoFace(s);
  return hiCanvas((g) => {
    g.save();
    g.beginPath();
    g.arc(256, 256, 256, 0, 7);
    g.clip();
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, 512, 512);
    const sh = g.createRadialGradient(170, 140, 10, 256, 256, 300);
    sh.addColorStop(0, "rgba(255,255,255,.38)");
    sh.addColorStop(0.5, "rgba(255,255,255,.04)");
    sh.addColorStop(1, "rgba(0,0,0,.28)");
    g.fillStyle = sh;
    g.fillRect(0, 0, 512, 512);
    g.restore();
    g.strokeStyle = "rgba(255,255,255,.55)";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(256, 256, 240, 0, 7);
    g.stroke();
  });
}

function monoFace(s: StockArt): HTMLCanvasElement {
  return hiCanvas((g) => {
    g.fillStyle = s.bg;
    g.fillRect(0, 0, 512, 512);
    const sh = g.createRadialGradient(170, 140, 10, 256, 256, 300);
    sh.addColorStop(0, "rgba(255,255,255,.55)");
    sh.addColorStop(0.5, "rgba(255,255,255,.06)");
    sh.addColorStop(1, "rgba(0,0,0,.35)");
    g.fillStyle = sh;
    g.fillRect(0, 0, 512, 512);
    guilloche(g, "rgba(255,255,255,.12)", 140);
    g.strokeStyle = "rgba(255,255,255,.65)";
    g.lineWidth = 5;
    g.beginPath();
    g.arc(256, 256, 232, 0, 7);
    g.stroke();
    const lab = (s.name.toUpperCase() + " ✦ ").repeat(Math.max(2, Math.round(40 / (s.name.length + 3))));
    ringText(g, lab, 206, `600 22px ${FONT_D}`, s.fg);
    g.fillStyle = s.fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${s.mono.length > 2 ? 150 : 190}px ${FONT_D}`;
    g.fillText(s.mono, 256, 266);
  });
}

function imageFace(src: string, label: string): Promise<HTMLCanvasElement> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () =>
      res(
        hiCanvas((g) => {
          const bg = g.createRadialGradient(180, 160, 30, 256, 256, 270);
          bg.addColorStop(0, "#1f5236");
          bg.addColorStop(1, "#06150d");
          g.fillStyle = bg;
          g.fillRect(0, 0, 512, 512);
          ringText(g, (label + " ✦ PAYS DIVIDENDS ✦ ").repeat(2), 222, `600 18px ${FONT_D}`, "rgba(200,255,224,.8)");
          g.save();
          g.beginPath();
          g.arc(256, 256, 196, 0, 7);
          g.clip();
          g.drawImage(img, 60, 60, 392, 392);
          const gl = g.createLinearGradient(0, 60, 0, 452);
          gl.addColorStop(0, "rgba(255,255,255,.16)");
          gl.addColorStop(0.45, "rgba(255,255,255,0)");
          g.fillStyle = gl;
          g.fillRect(0, 0, 512, 512);
          g.restore();
          g.strokeStyle = "#86EFAC";
          g.lineWidth = 5;
          g.beginPath();
          g.arc(256, 256, 198, 0, 7);
          g.stroke();
        }),
      );
    img.onerror = () => res(logoFace());
    // A cross-origin picture (object storage) would taint the canvas and WebGL would refuse it as a
    // texture. Asking for CORS keeps it usable, and without CORS it falls back to the logo face.
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

let REED: HTMLCanvasElement | null = null;
function reedTex(): HTMLCanvasElement {
  if (REED) return REED;
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 72;
  const g = c.getContext("2d")!;
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 2048, 72);
  const n = 220,
    w = 2048 / n;
  for (let i = 0; i < n; i++) {
    const gr = g.createLinearGradient(i * w, 0, (i + 1) * w, 0);
    gr.addColorStop(0, "#5a5a5a");
    gr.addColorStop(0.5, "#d0d0d0");
    gr.addColorStop(1, "#5a5a5a");
    g.fillStyle = gr;
    g.fillRect(i * w, 31, w, 10);
  }
  REED = c;
  return c;
}

function makeEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, "#0c2417");
  gr.addColorStop(0.32, "#2d7a50");
  gr.addColorStop(0.5, "#b6f5cf");
  gr.addColorStop(0.6, "#1a4a30");
  gr.addColorStop(1, "#020604");
  g.fillStyle = gr;
  g.fillRect(0, 0, 1024, 512);
  g.filter = "blur(10px)";
  g.fillStyle = "#ffffff";
  g.fillRect(110, 80, 240, 70);
  g.fillRect(650, 60, 260, 56);
  g.fillStyle = "#d9ffe9";
  g.fillRect(430, 300, 170, 110);
  g.fillStyle = "#7ef2d8";
  g.fillRect(850, 250, 120, 90);
  g.filter = "none";
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.encoding = THREE.sRGBEncoding;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(t).texture;
  pm.dispose();
  t.dispose();
  return env;
}

function buildCoin(frontC: HTMLCanvasElement, backC: HTMLCanvasElement, { r = 1, metal = 0x3ddc84 }: { r?: number; metal?: number } = {}): THREE.Group {
  const grp = new THREE.Group();
  const prof = (
    [[0.8, -0.085], [0.845, -0.118], [0.93, -0.124], [0.985, -0.106], [1, -0.07], [1, 0.07], [0.985, 0.106], [0.93, 0.124], [0.845, 0.118], [0.8, 0.085]] as const
  ).map(([x, y]) => new THREE.Vector2(x * r, y * r));
  const bump = new THREE.CanvasTexture(reedTex());
  const rimMat = new THREE.MeshPhysicalMaterial({ color: metal, metalness: 1, roughness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.2, bumpMap: bump, bumpScale: 0.18 });
  const rim = new THREE.Mesh(new THREE.LatheGeometry(prof, 160), rimMat);
  rim.rotation.x = Math.PI / 2;
  const fm = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 8;
    return new THREE.MeshPhysicalMaterial({ map: t, metalness: 0.3, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.1 });
  };
  const fg = new THREE.CircleGeometry(0.812 * r, 128);
  const front = new THREE.Mesh(fg, fm(frontC));
  front.position.z = 0.0865 * r;
  const back = new THREE.Mesh(fg, fm(backC));
  back.position.z = -0.0865 * r;
  back.rotation.y = Math.PI;
  grp.add(rim, front, back);
  return grp;
}

function softDot(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.35, "rgba(200,255,224,.6)");
  gr.addColorStop(1, "rgba(200,255,224,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/* ---------- shared loop ---------- */

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: THREE.PerspectiveCamera;
  host: HTMLElement;
  fit: () => void;
  visible: boolean;
  alive: boolean;
  tick: ((dt: number, t: number) => void) | null;
  mx: number;
  my: number;
  io?: IntersectionObserver;
  cleanup: (() => void)[];
}

const scenes = new Set<Scene>();
let raf = 0;
let lastT = 0;

function loop(now: number) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  scenes.forEach((S) => {
    if (!S.alive || !S.visible || document.hidden) return;
    S.tick?.(dt, now / 1000);
    S.renderer.render(S.scene, S.cam);
  });
  raf = scenes.size ? requestAnimationFrame(loop) : 0;
}

function onResize() {
  scenes.forEach((S) => S.fit());
}

function baseScene(host: HTMLElement, { fov = 30, z = 10 }: { fov?: number; z?: number } = {}): Scene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  cam.position.set(0, 0, z);
  scene.environment = makeEnv(renderer);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 5, 7);
  scene.add(key);
  const rimL = new THREE.PointLight(0x4ade80, 3, 30);
  rimL.position.set(-4, -1, -3);
  scene.add(rimL);
  const fill = new THREE.PointLight(0x7ef2d8, 1.2, 30);
  fill.position.set(5, -2, 4);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));
  const fit = () => {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  fit();
  const S: Scene = { renderer, scene, cam, host, fit, visible: true, alive: true, tick: null, mx: 0, my: 0, cleanup: [] };
  const move = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    S.mx = (e.clientX - r.left) / r.width - 0.5;
    S.my = (e.clientY - r.top) / r.height - 0.5;
  };
  const leave = () => {
    S.mx = 0;
    S.my = 0;
  };
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerleave", leave);
  S.cleanup.push(() => {
    host.removeEventListener("pointermove", move);
    host.removeEventListener("pointerleave", leave);
  });
  if ("IntersectionObserver" in window) {
    S.io = new IntersectionObserver((e) => (S.visible = !!e[0]?.isIntersecting));
    S.io.observe(host);
  }
  if (!scenes.size) window.addEventListener("resize", onResize);
  scenes.add(S);
  if (!raf) {
    lastT = performance.now();
    raf = requestAnimationFrame(loop);
  }
  return S;
}

function dispose(S: Scene) {
  S.alive = false;
  S.io?.disconnect();
  S.cleanup.forEach((f) => f());
  S.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
  S.scene.environment?.dispose();
  S.renderer.dispose();
  S.renderer.domElement.remove();
  scenes.delete(S);
  if (!scenes.size) window.removeEventListener("resize", onResize);
}

export type Stop = () => void;

async function fontsReady() {
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts are cosmetic */
  }
}

/* ---------- scenes ---------- */

/** Hero: the hwai coin with six stock coins orbiting it and a field of sparkles. Click spins it. */
export async function heroScene(host: HTMLElement, featured: StockArt[]): Promise<Stop> {
  await fontsReady();
  const faces = await Promise.all(featured.map(stockFace));
  if (!host.isConnected) return () => {};
  const S = baseScene(host, { fov: 30, z: 10.5 });
  S.scene.fog = new THREE.Fog(0x0a0f0d, 9.5, 15);
  const main = buildCoin(logoFace(), logoFace(), { r: 1.5 });
  S.scene.add(main);
  const sats = featured.map((s, i) => {
    const f = faces[i]!;
    const m = buildCoin(f, f, { r: 0.44, metal: new THREE.Color(s.bg).lerp(new THREE.Color(0xffffff), 0.2).getHex() });
    S.scene.add(m);
    return { m, a: (i / featured.length) * Math.PI * 2, w: 0.5 + i * 0.13 };
  });
  const n = 140,
    pos = new Float32Array(n * 3);
  const rr = mulberry32(9);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rr() - 0.5) * 11;
    pos[i * 3 + 1] = (rr() - 0.5) * 8;
    pos[i * 3 + 2] = (rr() - 0.5) * 5 - 1.5;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(
    pg,
    new THREE.PointsMaterial({ map: new THREE.CanvasTexture(softDot()), size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75 }),
  );
  S.scene.add(pts);
  const tilt = new THREE.Euler(0.3, 0, -0.14),
    R = 2.6,
    v = new THREE.Vector3();
  let spin = 0,
    target = 0;
  const click = () => (target += Math.PI * 2);
  host.addEventListener("click", click);
  S.cleanup.push(() => host.removeEventListener("click", click));
  const still = reduced();
  S.tick = (dt, t) => {
    spin += (target - spin) * Math.min(1, dt * 3.2);
    const sway = still ? 0 : Math.sin(t * 0.45) * 0.42;
    main.rotation.y = spin + sway + S.mx * 0.7;
    main.rotation.x = (still ? 0 : Math.sin(t * 0.33) * 0.1) - S.my * 0.45;
    main.position.y = still ? 0.1 : 0.1 + Math.sin(t * 0.9) * 0.12;
    sats.forEach((o) => {
      if (!still) o.a += dt * 0.24;
      v.set(Math.cos(o.a) * R, 0, Math.sin(o.a) * R).applyEuler(tilt);
      o.m.position.copy(v);
      o.m.position.y += 0.1 + Math.sin(t * 1.2 + o.w) * 0.06;
      o.m.lookAt(S.cam.position);
      o.m.rotateY(Math.sin(t * o.w + o.a) * 0.38);
      o.m.rotateX(Math.cos(t * 0.8 + o.a) * 0.12);
    });
    pts.rotation.y += dt * 0.015;
    S.cam.position.x += (S.mx * 1.4 - S.cam.position.x) * 0.05;
    S.cam.position.y += (-S.my * 0.9 - S.cam.position.y) * 0.05;
    S.cam.lookAt(0, 0, 0);
  };
  return () => dispose(S);
}

/**
 * A single coin: meme picture on the front, the dividend stock on the back.
 * "flip" turns it over every few seconds (coin page); "spin" spins continuously (launch modal).
 */
export async function coinScene(host: HTMLElement, src: string, back: StockArt | null, { mode = "flip", label = "" }: { mode?: "flip" | "spin"; label?: string } = {}): Promise<Stop> {
  await fontsReady();
  const front = await imageFace(src, label);
  const backC = back ? await stockFace(back) : logoFace();
  if (!host.isConnected) return () => {};
  const S = baseScene(host, { fov: 30, z: mode === "spin" ? 5.6 : 5.2 });
  const coin = buildCoin(front, backC, { r: 1.15 });
  S.scene.add(coin);
  let rot = 0;
  const still = reduced();
  S.tick = (dt, t) => {
    if (mode === "spin") {
      rot += dt * 5.5;
      coin.rotation.y = rot;
      coin.rotation.x = 0.18;
    } else {
      const c = t % 7;
      const y = c < 3 ? 0 : c < 3.8 ? ease((c - 3) / 0.8) * Math.PI : c < 6.2 ? Math.PI : Math.PI + ease((c - 6.2) / 0.8) * Math.PI;
      coin.rotation.y = (still ? 0 : y) + Math.sin(t * 0.8) * 0.2 + S.mx * 0.6;
      coin.rotation.x = Math.sin(t * 0.6) * 0.1 - S.my * 0.4;
    }
    coin.position.y = still ? 0 : Math.sin(t * 1.3) * 0.05;
  };
  return () => dispose(S);
}

/** The coin's parts, for the brand videos (brand/uspad/src/coins3d.ts), which render these coins frame by frame. */
export { buildCoin, logoFace, makeEnv, softDot, stockFace };
