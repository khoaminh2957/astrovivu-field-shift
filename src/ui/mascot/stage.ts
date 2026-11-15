/**
 * One 3D character on a transparent WebGL canvas. A TypeScript port of `src/mascot-stage.js` of the
 * mascot owner's "Triple Mascot Portable Kit 1.0" (see docs/MASCOT.md), kept to what the app uses:
 * one character per stage, its clips, the gaze. The models are animated node hierarchies, not skinned rigs.
 *
 * This module pulls in three.js: import it lazily (`import('./stage')`), never from the main bundle.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type MascotId = 'Rice' | 'Seed' | 'Satellite';
export type MascotClip = 'Idle' | 'Wave' | 'Point' | 'PointLeft' | 'Jump' | 'Celebrate' | 'Run' | 'Spin' | 'Think' | 'Talk' | 'Hover' | 'LeafWiggle' | 'Scan';

const LOOP_CLIPS = new Set<string>(['Idle', 'Hover']);
const DEFAULT_CLIP: Record<MascotId, MascotClip> = { Rice: 'Idle', Seed: 'Idle', Satellite: 'Hover' };
const CLIP_FALLBACK: Partial<Record<MascotClip, MascotClip>> = { Scan: 'Point', LeafWiggle: 'Wave', Hover: 'Idle', Run: 'Jump', PointLeft: 'Point' };
const EYES = /^rice-face-(left|right)-eye$|^seed-eye[LR]$|^satellite-eye[LR]$/;
/** The characters are drawn at 30 frames a second at most: the map behind keeps the rest. */
const FRAME_MS = 30;

interface Actor {
  mixer: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  action: THREE.AnimationAction | null;
  eyes: { node: THREE.Object3D; rest: THREE.Vector3 }[];
  root: THREE.Group;
}

export class MascotStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
  private readonly canvas: HTMLCanvasElement;
  private readonly observer: ResizeObserver | null;
  private readonly reduced: boolean;
  private actor: Actor | null = null;
  private gaze = { x: 0, y: 0 };
  private raf = 0;
  private lastFrame = 0;
  private lastTime = performance.now();
  private disposed = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly id: MascotId,
    private readonly assetBase: string,
  ) {
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%';
    element.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: 'low-power' });
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc2d3c9, 1.5));
    const key = new THREE.DirectionalLight(0xfffaed, 2.2);
    key.position.set(-2.5, 5, 6);
    const fill = new THREE.DirectionalLight(0xcdeeff, 1.2);
    fill.position.set(3, 2, -3);
    this.scene.add(key, fill);
    this.camera.position.set(0, 1.45, 5.5);
    this.camera.lookAt(0, 1.4, 0);

    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.observer?.observe(element);
    this.resize();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Loads the model and starts its resting clip. Rejects when the file cannot be read. */
  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(`${this.assetBase}/${this.id}/${this.id}.glb`);
    if (this.disposed) return;
    const root = new THREE.Group();
    root.add(gltf.scene);
    root.scale.setScalar(0.94);
    this.scene.add(root);
    const eyes: Actor['eyes'] = [];
    gltf.scene.traverse((obj) => {
      if (EYES.test(obj.name)) eyes.push({ node: obj, rest: obj.position.clone() });
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial) {
          std.roughness = Math.min(std.roughness, 0.39);
          std.metalness = Math.min(std.metalness, 0.13);
        }
      }
    });
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const actor: Actor = { mixer, clips: gltf.animations, action: null, eyes, root };
    // A one-shot clip hands back to the resting clip when it ends.
    mixer.addEventListener('finished', (e) => {
      if (actor.action === e.action && !this.disposed) this.start(actor, DEFAULT_CLIP[this.id], true, 0.16);
    });
    this.actor = actor;
    this.start(actor, DEFAULT_CLIP[this.id], true, 0);
  }

  play(clip: MascotClip): void {
    if (this.actor) this.start(this.actor, this.reduced ? DEFAULT_CLIP[this.id] : clip, undefined, 0.2);
  }

  /** Where the eyes look, -1..1 on each axis. */
  setGaze(x: number, y: number): void {
    this.gaze = { x: THREE.MathUtils.clamp(x || 0, -1, 1), y: THREE.MathUtils.clamp(y || 0, -1, 1) };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    if (this.actor) {
      this.actor.mixer.stopAllAction();
      this.actor.root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m?.dispose();
      });
    }
    this.renderer.dispose();
    this.canvas.remove();
  }

  private start(actor: Actor, requested: MascotClip, loop: boolean | undefined, crossfade: number): void {
    const named = (name?: string) => actor.clips.find((c) => c.name === name);
    const clip = named(requested) ?? named(CLIP_FALLBACK[requested]) ?? named(DEFAULT_CLIP[this.id]);
    if (!clip) return;
    const old = actor.action;
    const action = actor.mixer.clipAction(clip);
    if (old !== action) {
      const repeat = loop ?? LOOP_CLIPS.has(clip.name);
      action.reset();
      action.setLoop(repeat ? THREE.LoopRepeat : THREE.LoopOnce, repeat ? Infinity : 1);
      action.enabled = true;
      action.play();
      if (old && crossfade && !this.reduced) action.crossFadeFrom(old, crossfade, true);
      else old?.stop();
    } else if (!action.isRunning()) action.reset().play();
    actor.action = action;
  }

  private resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.element.clientWidth);
    const h = Math.max(1, this.element.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (now - this.lastFrame < FRAME_MS) return;
    this.lastFrame = now;
    const dt = Math.min(0.07, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (document.hidden || !this.actor) return;
    if (!this.reduced) {
      this.actor.mixer.update(dt);
      for (const { node, rest } of this.actor.eyes) {
        node.position.x = THREE.MathUtils.damp(node.position.x, rest.x + this.gaze.x * 0.045, 7, dt);
        node.position.y = THREE.MathUtils.damp(node.position.y, rest.y - this.gaze.y * 0.025, 7, dt);
      }
    }
    this.renderer.render(this.scene, this.camera);
  };
}
