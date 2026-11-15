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
  /** Rest position and scale of each eye: the models draw the eyes with a small, uneven scale (about 0.1 by 0.13). */
  eyes: { node: THREE.Object3D; rest: THREE.Vector3; scale: THREE.Vector3 }[];
  root: THREE.Group;
}

export class MascotStage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
  private readonly canvas: HTMLCanvasElement;
  private readonly observer: ResizeObserver | null;
  private reduced: boolean;
  private actor: Actor | null = null;
  /** Life between clips: breathing, a bob, a sway, blinks and a wandering gaze. Phase differs per character. */
  private readonly phase: number;
  private clock = 0;
  private nextBlink = 2 + Math.random() * 3;
  private blinkUntil = 0;
  private nextWander = 1.5 + Math.random() * 2;
  private wander = { x: 0, y: 0 };
  private pointerAt = 0;
  private gaze = { x: 0, y: 0 };
  /** A point the character is told to look at; it wins over the pointer while set. */
  private aim: { x: number; y: number } | null = null;
  private raf = 0;
  private lastFrame = 0;
  private lastTime = performance.now();
  private disposed = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly id: MascotId,
    private readonly assetBase: string,
    reduced?: boolean,
  ) {
    // The app's own motion setting wins (it follows the system unless the visitor turned motion on or off).
    this.reduced = reduced ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.phase = { Rice: 0, Seed: 2.1, Satellite: 4.2 }[id];
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
      if (EYES.test(obj.name)) eyes.push({ node: obj, rest: obj.position.clone(), scale: obj.scale.clone() });
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
    this.pointerAt = this.clock;
  }

  /** Motion on or off, from the app's setting; off leaves the character at rest. */
  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced && this.actor) {
      this.actor.root.position.y = 0;
      this.actor.root.rotation.z = 0;
      this.actor.root.scale.setScalar(0.94);
      for (const { node, scale } of this.actor.eyes) node.scale.y = scale.y;
    }
  }

  /**
   * Turns the eyes, and the body a little, toward a point (-1..1 on each axis), whatever the
   * pointer does; null hands the eyes back to the pointer and the body back to facing front.
   */
  aimAt(target: { x: number; y: number } | null): void {
    this.aim = target ? { x: THREE.MathUtils.clamp(target.x || 0, -1, 1), y: THREE.MathUtils.clamp(target.y || 0, -1, 1) } : null;
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
      this.clock += dt;
      const c = this.clock;
      this.actor.mixer.update(dt);
      // With nobody pointing and nothing to aim at, the eyes wander to a new spot every few seconds.
      if (c >= this.nextWander) {
        this.nextWander = c + 1.8 + Math.random() * 2.6;
        this.wander = Math.random() < 0.3 ? { x: 0, y: 0 } : { x: Math.random() * 1.6 - 0.8, y: Math.random() * 0.8 - 0.4 };
      }
      const idlePointer = c - this.pointerAt > 2.5;
      const look = this.aim ?? (idlePointer ? this.wander : this.gaze);
      // A blink: the eyes close for a tenth of a second every 2 to 5 seconds.
      if (c >= this.nextBlink) {
        this.blinkUntil = c + 0.11;
        this.nextBlink = c + 2 + Math.random() * 3;
      }
      const lid = c < this.blinkUntil ? 0.12 : 1;
      for (const { node, rest, scale } of this.actor.eyes) {
        node.position.x = THREE.MathUtils.damp(node.position.x, rest.x + look.x * 0.045, 7, dt);
        node.position.y = THREE.MathUtils.damp(node.position.y, rest.y - look.y * 0.025, 7, dt);
        // Relative to the eye's own height in the model: a target of 1 stretched the eyes about eight times.
        node.scale.y = THREE.MathUtils.damp(node.scale.y, scale.y * lid, 30, dt);
      }
      // The clips animate the nodes inside the model, so the wrapper is free to move: breathe, bob, sway, turn.
      const root = this.actor.root;
      const t = c + this.phase;
      root.position.y = Math.sin(t * 2.4) * 0.035;
      root.rotation.z = Math.sin(t * 1.3) * 0.035;
      const breath = 1 + Math.sin(t * 1.9) * 0.012;
      root.scale.set(0.94 / Math.sqrt(breath), 0.94 * breath, 0.94 / Math.sqrt(breath));
      const turn = this.aim ? this.aim.x * 0.55 : look.x * 0.18;
      root.rotation.y = THREE.MathUtils.damp(root.rotation.y, turn, 3.5, dt);
    }
    this.renderer.render(this.scene, this.camera);
  };
}
