/**
 * The $USPAD coin for token-video.cjs, in the site's own 3D coin (apps/web/src/three/scenes.ts), shot
 * like a product film and rendered frame by frame: `frame(t)` poses everything for second t and renders
 * once. A macro pass along the reeded rim in the dark, the coin turning to face the camera under a
 * sweeping light, the six stock coins orbiting it, and a closing push in.
 *
 * With `glow`, each frame is also drawn at half size into that 2D canvas, which the page blurs and
 * screens over the coins: a soft bloom without the banding of 8-bit render targets.
 */
import * as THREE from "three";
import { buildCoin, logoFace, makeEnv, softDot, stockFace, type StockArt } from "../../../apps/web/src/three/scenes";

/** Scene times in seconds, the same as token-video.cjs's S. */
export interface Timeline {
  macro: [number, number];
  reveal: [number, number];
  orbit: [number, number];
  end: [number, number];
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const inOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outBack = (x: number) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const within = (t: number, [s, d]: [number, number]) => t >= s && t < s + d;

async function init(canvas: HTMLCanvasElement, stocks: StockArt[], T: Timeline, { glow }: { glow?: HTMLCanvasElement } = {}) {
  const glowCtx = glow?.getContext("2d") ?? null;
  await document.fonts.ready;
  const faces = await Promise.all(stocks.map(stockFace));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.environment = makeEnv(renderer);
  const cam = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.05, 100);

  // A dim key, two green rims, and a hard white light that sweeps across the coin for the glints.
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(3, 5, 7);
  const rimL = new THREE.PointLight(0x4ade80, 4, 30);
  rimL.position.set(-4, 1, -3);
  const rimR = new THREE.PointLight(0x7ef2d8, 2.5, 30);
  rimR.position.set(5, -2, -2);
  const sweep = new THREE.PointLight(0xffffff, 0, 14);
  scene.add(key, rimL, rimR, sweep, new THREE.AmbientLight(0xffffff, 0.08));

  const main = buildCoin(logoFace(), logoFace(), { r: 1.5 });
  scene.add(main);
  const sats = stocks.map((s, i) => {
    const m = buildCoin(faces[i]!, faces[i]!, { r: 0.55, metal: new THREE.Color(s.bg).lerp(new THREE.Color(0xffffff), 0.2).getHex() });
    scene.add(m);
    return m;
  });

  // Dust in the light, for depth.
  const n = 420;
  const pos = new Float32Array(n * 3);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * 16;
    pos[i * 3 + 1] = (rnd() - 0.5) * 10;
    pos[i * 3 + 2] = (rnd() - 0.5) * 12 - 1;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(pg, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(softDot()), size: 0.06, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  scene.add(dust);

  const look = new THREE.Vector3();
  const lookAt = (x: number, y: number, z: number) => cam.lookAt(look.set(x, y, z));
  const fov = (f: number) => {
    if (cam.fov !== f) {
      cam.fov = f;
      cam.updateProjectionMatrix();
    }
  };
  const tilt = new THREE.Euler(1.15, 0, 0.25);
  const v = new THREE.Vector3();

  return (t: number): number => {
    let alpha = 0;
    let exposure = 1.1;
    dust.rotation.y = t * 0.015;
    sweep.intensity = 0;
    main.visible = true;
    sats.forEach((m) => (m.visible = false));

    if (within(t, T.macro)) {
      // In the dark, along the rim: the coin edge-on, turning on its own axis, the camera almost on it.
      const [s, d] = T.macro;
      const k = span(t, s, s + d);
      fov(18);
      exposure = 0.03 + 0.72 * outCubic(span(t, s + 0.2, s + 2.6));
      // Edge-on, so the reeded rim faces the camera, and slowly turning on its own axis.
      main.rotation.set(0, Math.PI / 2 - 0.1, -0.6 + t * 0.3);
      main.position.set(0, 0, 0);
      cam.position.set(0.9 - 0.6 * k, 0.75 - 0.25 * k, 5.2 - 0.6 * inOutCubic(k));
      lookAt(0, 0.15, 1.1);
      // A glint runs along the rim.
      sweep.intensity = 5 * Math.sin(Math.PI * span(t, s + 1.6, s + 4.6));
      sweep.position.set(2.6 - 5.2 * span(t, s + 1.6, s + 4.6), 1.6, 3.6);
      alpha = span(t, s, s + 0.3) * (1 - span(t, s + d - 0.25, s + d));
    } else if (within(t, T.reveal)) {
      // It turns to face the camera as the camera pulls back, and a white light sweeps across its face.
      const [s, d] = T.reveal;
      const turn = outBack(span(t, s, s + 1.7));
      const pull = outCubic(span(t, s, s + 2.4));
      fov(16 + 14 * pull);
      exposure = 1.15;
      main.rotation.set(0.12 * Math.sin(t * 0.6), (Math.PI / 2) * (1 - turn) + 0.22 * Math.sin(t * 0.5), 0);
      main.position.set(0, 0.95 + Math.sin(t * 0.9) * 0.05, 0);
      // Ends with the coin above the title, clear of the letterbox.
      cam.position.set(0.3 * (1 - pull), 0.2, 3.2 + 8.3 * pull);
      lookAt(0, 0.95 - 0.91 * pull, 0);
      const sw = span(t, s + 1.5, s + 3.1);
      sweep.intensity = 14 * Math.sin(Math.PI * sw);
      sweep.position.set(-5 + 10 * sw, 2.2, 3);
      alpha = span(t, s, s + 0.15) * (1 - span(t, s + d - 0.4, s + d));
    } else if (within(t, T.orbit)) {
      // The six stock coins orbit it on a steep ring that passes right by the camera.
      const [s, d] = T.orbit;
      const k = inOutCubic(span(t, s, s + d));
      fov(32);
      exposure = 1.15;
      main.rotation.set(0.1 * Math.sin(t * 0.7), 0.35 * Math.sin(t * 0.45), 0);
      main.position.set(0, 0.5, 0);
      cam.position.set(-0.8 + 1.6 * k, 0.6, 10.5 - 1.8 * k);
      lookAt(0, -0.35, 0);
      sats.forEach((m, i) => {
        m.visible = true;
        const a = (i / sats.length) * Math.PI * 2 + (t - s) * 0.55;
        v.set(Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4).applyEuler(tilt);
        m.position.copy(v).add(main.position);
        m.scale.setScalar(Math.max(0.0001, outBack(span(t, s + 0.1 * i, s + 0.1 * i + 0.9))));
        m.rotation.set(0.3 * Math.sin(t + i), (t - s) * 1.6 + i, 0);
      });
      alpha = span(t, s, s + 0.35) * (1 - span(t, s + d - 0.4, s + d));
    } else if (within(t, T.end)) {
      // The closing shot: face on, a slow push in, one last glint.
      const [s, d] = T.end;
      const k = inOutCubic(span(t, s, s + d));
      fov(30);
      exposure = 1.15;
      main.rotation.set(0.08 * Math.sin(t * 0.7), Math.PI * 2 * inOutCubic(span(t, s, s + 1.6)) + 0.25 * Math.sin(t * 0.45), 0);
      main.position.set(0, 1.05 + Math.sin(t * 0.9) * 0.05, 0);
      cam.position.set(0.25 - 0.5 * k, 0.15, 13.2 - 1.2 * k);
      lookAt(0, 0.11, 0);
      const sw = span(t, s + 1.7, s + 3.1);
      sweep.intensity = 12 * Math.sin(Math.PI * sw);
      sweep.position.set(-5 + 10 * sw, 2.6, 3);
      alpha = span(t, s, s + 0.5);
    }

    canvas.style.opacity = String(alpha);
    if (alpha > 0) {
      renderer.toneMappingExposure = exposure;
      renderer.render(scene, cam);
    }
    if (glow && glowCtx) {
      glow.style.opacity = String(alpha * 0.55);
      glowCtx.clearRect(0, 0, glow.width, glow.height);
      if (alpha > 0) glowCtx.drawImage(canvas, 0, 0, glow.width, glow.height);
    }
    return alpha;
  };
}

declare global {
  interface Window {
    token3d: { init: typeof init };
  }
}
window.token3d = { init };
