import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ============================================================
// PATIENT ZERO - Bioluminescent Ocean Scene
// ============================================================

export class BioluminescentScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private orbitAngle = 0;
  private orbitRadius = 150;
  private ambientParticles: THREE.Points | null = null;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010204);
    this.scene.fog = new THREE.FogExp2(0x010204, 0.008);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.camera.position.set(0, 60, this.orbitRadius);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    container.appendChild(this.renderer.domElement);

    // Post-processing Bloom
    const renderScene = new RenderPass(this.scene, this.camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      2.5,  // strength
      0.5,  // radius
      0.1   // threshold
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderScene);
    this.composer.addPass(bloomPass);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x001133, 1.5);
    this.scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00aaff, 1.0, 400);
    pointLight.position.set(0, 80, 0);
    this.scene.add(pointLight);

    // Ambient ocean particles
    this.createAmbientOcean();

    // Handle resize
    window.addEventListener('resize', () => this.onResize());
  }

  private createAmbientOcean(): void {
    const count = 800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 400;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 400;
      // Brighter blue-green tint
      colors[i * 3]     = 0;
      colors[i * 3 + 1] = 0.15 + Math.random() * 0.15;
      colors[i * 3 + 2] = 0.2  + Math.random() * 0.25;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 1.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });

    this.ambientParticles = new THREE.Points(geo, mat);
    this.scene.add(this.ambientParticles);
  }

  update(delta: number): void {
    // Slow camera orbit
    this.orbitAngle += delta * 0.04;
    const oscillate = Math.sin(this.orbitAngle * 0.3) * 20;
    this.camera.position.x = Math.sin(this.orbitAngle) * (this.orbitRadius + oscillate);
    this.camera.position.z = Math.cos(this.orbitAngle) * (this.orbitRadius + oscillate);
    this.camera.position.y = 50 + Math.sin(this.orbitAngle * 0.5) * 15;
    this.camera.lookAt(0, 0, 0);

    // Drift ambient particles upward slowly
    if (this.ambientParticles) {
      const positions = this.ambientParticles.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        positions.setY(i, positions.getY(i) + delta * 1.5);
        if (positions.getY(i) > 100) positions.setY(i, -100);
      }
      positions.needsUpdate = true;
    }
  }

  render(): void {
    this.composer.render();
  }

  getDelta(): number {
    return this.clock.getDelta();
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.Camera {
    return this.camera;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }
}
