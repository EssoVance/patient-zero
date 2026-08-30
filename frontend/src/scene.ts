import * as THREE from 'three';

// ============================================================
// PATIENT ZERO — Bioluminescent Ocean Scene
// ============================================================

export class BioluminescentScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private orbitAngle = 0;
  private orbitRadius = 150;
  private ambientParticles: THREE.Points | null = null;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020408);
    this.scene.fog = new THREE.FogExp2(0x010206, 0.012);

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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x001133, 0.8);
    this.scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x0044ff, 0.5, 300);
    pointLight.position.set(0, 80, 0);
    this.scene.add(pointLight);

    // Ambient ocean particles
    this.createAmbientOcean();

    // Handle resize
    window.addEventListener('resize', () => this.onResize());
  }

  private createAmbientOcean(): void {
    const count = 600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 400;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 400;
      // Dim blue-green tint
      colors[i * 3]     = 0;
      colors[i * 3 + 1] = 0.05 + Math.random() * 0.08;
      colors[i * 3 + 2] = 0.1  + Math.random() * 0.15;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.4,
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
        positions.setY(i, positions.getY(i) + delta * 0.5);
        if (positions.getY(i) > 100) positions.setY(i, -100);
      }
      positions.needsUpdate = true;
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
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
  }
}
