import * as THREE from 'three';
import { TokenAnalysisResult, ScoredWallet } from './appState';

// ============================================================
// PATIENT ZERO — Mode 2 Particle System (Specific Analysis)
// ============================================================

const COLOR_LEADING = new THREE.Color(0x00ffff); // bright cyan
const COLOR_FOLLOWER = new THREE.Color(0x006633); // dim green

interface Mode2Particle {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  wallet: string;
  isLeading: boolean;
  score: number;
}

export class Mode2Scene {
  private scene: THREE.Scene;
  private particles: Mode2Particle[] = [];
  private glowTexture: THREE.Texture;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.glowTexture = this.createGlowTexture();
  }

  private createGlowTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    );
    gradient.addColorStop(0,   'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  clear(): void {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      this.scene.remove(p.glow);
    }
    this.particles = [];
  }

  renderTokenAnalysis(data: TokenAnalysisResult): void {
    this.clear();

    const renderGroup = (wallets: ScoredWallet[], isLeading: boolean, radiusOffset: number) => {
      const count = wallets.length;
      for (let i = 0; i < count; i++) {
        const w = wallets[i];
        
        // Arrange in a circle
        const angle = (i / count) * Math.PI * 2;
        const radius = isLeading ? 30 : 60; // Leaders in center, followers outside
        
        const x = Math.cos(angle) * (radius + radiusOffset);
        const z = Math.sin(angle) * (radius + radiusOffset);
        const y = (Math.random() - 0.5) * 20;

        const pos = new THREE.Vector3(x, y, z);
        const color = isLeading ? COLOR_LEADING.clone() : COLOR_FOLLOWER.clone();
        
        // Sizes based on blueprint
        const pSize = isLeading ? 3.0 + w.originator_score * 2.0 : 2.0 + w.originator_score * 1.0;

        const geo = new THREE.SphereGeometry(pSize, 12, 12);
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: isLeading ? 0.9 : 0.6,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        
        // Embed wallet data for Raycaster
        mesh.userData = { wallet: w.wallet };

        const glowMat = new THREE.SpriteMaterial({
          map: this.glowTexture,
          color,
          transparent: true,
          opacity: isLeading ? 0.6 : 0.2,
          blending: THREE.AdditiveBlending,
        });
        const glow = new THREE.Sprite(glowMat);
        glow.scale.set(pSize * 6, pSize * 6, 1);
        glow.position.copy(pos);

        this.scene.add(mesh);
        this.scene.add(glow);

        this.particles.push({
          mesh,
          glow,
          wallet: w.wallet,
          isLeading,
          score: w.originator_score,
        });
      }
    };

    renderGroup(data.leading_wallets, true, 0);
    renderGroup(data.follower_wallets, false, 0);
  }

  update(delta: number): void {
    this.time += delta;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      // Gentle floating animation
      const offset = i * 0.5;
      p.mesh.position.y += Math.sin(this.time * 1.2 + offset) * 0.05;
      p.glow.position.copy(p.mesh.position);

      // Pulse leading wallets stronger
      if (p.isLeading) {
        const pulse = 0.5 + 0.3 * Math.sin(this.time * 2 + offset);
        (p.glow.material as THREE.SpriteMaterial).opacity = pulse;
      }
    }
  }

  getMeshes(): THREE.Mesh[] {
    return this.particles.map(p => p.mesh);
  }
}
