/**
 * The site's 3D coins (apps/web/src/three/scenes.ts) for launch-video.cjs, rendered frame by frame:
 * `frame(t)` poses everything for second t of the video and renders once, so every frame is exact
 * whatever the render speed. Bundled by launch-video.cjs with esbuild into the page.
 */
import * as THREE from "three";
import { buildCoin, logoFace, makeEnv, softDot, stockFace, type StockArt } from "../../../apps/web/src/three/scenes";
import type { Group } from "three";

/** Scene times in seconds, the same as launch-video.cjs's S. */
export interface Timeline {
  open: [number, number];
  anyone: [number, number];
  paid: [number, number];
  cta: [number, number];
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const inOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

async function init(canvas: HTMLCanvasElement, stocks: StockArt[], T: Timeline) {
  await document.fonts.ready;
  const faces = await Promise.all(stocks.map(stockFace));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.environment = makeEnv(renderer);
  const cam = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 100);
  // The site's lights (baseScene).
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 5, 7);
  const rimL = new THREE.PointLight(0x4ade80, 3, 30);
  rimL.position.set(-4, -1, -3);
  const fill = new THREE.PointLight(0x7ef2d8, 1.2, 30);
  fill.position.set(5, -2, 4);
  scene.add(key, rimL, fill, new THREE.AmbientLight(0xffffff, 0.15));

  const main = buildCoin(logoFace(), logoFace(), { r: 1.5 });
  scene.add(main);
  const sats: Group[] = stocks.map((s, i) => {
    const m = buildCoin(faces[i]!, faces[i]!, { r: 0.44, metal: new THREE.Color(s.bg).lerp(new THREE.Color(0xffffff), 0.2).getHex() });
    scene.add(m);
    return m;
  });
  // Sparkles, as on the hero.
  const n = 220;
  const pos = new Float32Array(n * 3);
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * 14;
    pos[i * 3 + 1] = (rnd() - 0.5) * 9;
    pos[i * 3 + 2] = (rnd() - 0.5) * 6 - 1.5;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const sparkMat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(softDot()), size: 0.08, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
  const sparks = new THREE.Points(pg, sparkMat);
  scene.add(sparks);

  const tilt = new THREE.Euler(0.3, 0, -0.14);
  const v = new THREE.Vector3();
  const R = 2.6;

  /** The hero arrangement: the uspad coin with the stock coins orbiting it. */
  const hero = (t: number, enter: number) => {
    main.visible = true;
    sats.forEach((m, i) => {
      m.visible = true;
      const a = (i / sats.length) * Math.PI * 2 + t * 0.32;
      v.set(Math.cos(a) * R, 0, Math.sin(a) * R).applyEuler(tilt);
      const k = outBack(span(enter, 0.15 * i, 0.15 * i + 0.9));
      m.scale.setScalar(Math.max(0.0001, k));
      m.position.copy(v);
      m.position.y += 0.1 + Math.sin(t * 1.2 + i) * 0.06;
      m.lookAt(cam.position);
      m.rotateY(Math.sin(t * (0.5 + i * 0.13) + a) * 0.38);
      m.rotateX(Math.cos(t * 0.8 + a) * 0.12);
    });
  };

  return (t: number): number => {
    let alpha = 0;
    let exposure = 1.15;
    sparks.rotation.y = t * 0.02;
    if (t < T.anyone[0] + T.anyone[1]) {
      // Out of the dark: the coin turns to face us as the camera moves in and the stocks arrive.
      const [s] = T.open;
      const k = outCubic(span(t, s, s + 4.2));
      exposure = 0.05 + 1.1 * outCubic(span(t, s + 0.2, s + 2.6));
      cam.position.set(0.6 * (1 - k), -0.4, 16 - 4.4 * k);
      cam.lookAt(0, -1.05, 0);
      main.position.set(0, Math.sin(t * 0.9) * 0.08, 0);
      main.rotation.y = -2.4 * (1 - outCubic(span(t, s, s + 3.4))) + Math.sin(t * 0.45) * 0.3;
      main.rotation.x = 0.1 * Math.sin(t * 0.33);
      hero(t, t - (s + 1.4));
      alpha = span(t, s, s + 0.4) * (1 - 0.7 * span(t, T.anyone[0], T.anyone[0] + 0.6)) * (1 - span(t, T.anyone[0] + T.anyone[1] - 0.5, T.anyone[0] + T.anyone[1]));
    } else if (t >= T.paid[0] && t < T.paid[0] + T.paid[1]) {
      // The six stock coins drop into a row and flip over, one after another.
      const [s, d] = T.paid;
      main.visible = false;
      cam.position.set(0, 0, 11);
      cam.lookAt(0, -0.2, 0);
      sats.forEach((m, i) => {
        m.visible = true;
        const t0 = s + 0.25 + i * 0.16;
        const drop = outBack(span(t, t0, t0 + 0.75));
        m.scale.setScalar(1.55);
        m.position.set((i - (sats.length - 1) / 2) * 1.62, 1.0 + 3.4 * (1 - drop) + Math.sin(t * 1.4 + i) * 0.05, 0);
        m.rotation.set(0.12 * Math.sin(t * 0.9 + i), Math.PI * 2 * inOutCubic(span(t, t0 + 0.5, t0 + 1.5)) + 0.3 * Math.sin(t * 0.7 + i * 0.8), 0);
      });
      alpha = span(t, s, s + 0.3) * (1 - span(t, s + d - 0.4, s + d));
    } else if (t >= T.cta[0]) {
      // Back to the hero for the call to action: one full spin, then the idle sway.
      const [s] = T.cta;
      const k = inOutCubic(span(t, s, s + 7));
      cam.position.set(-0.4 + 0.8 * k, -0.5, 13 - 1.4 * k);
      cam.lookAt(0, -1.15, 0);
      main.position.set(0, Math.sin(t * 0.9) * 0.08, 0);
      main.rotation.y = Math.PI * 2 * inOutCubic(span(t, s + 0.2, s + 1.8)) + Math.sin(t * 0.45) * 0.3;
      main.rotation.x = 0.1 * Math.sin(t * 0.33);
      hero(t, t - s);
      alpha = span(t, s, s + 0.5);
    }
    canvas.style.opacity = String(alpha);
    if (alpha > 0) {
      renderer.toneMappingExposure = exposure;
      renderer.render(scene, cam);
    }
    return alpha;
  };
}

declare global {
  interface Window {
    coins3d: { init: typeof init };
  }
}
window.coins3d = { init };
