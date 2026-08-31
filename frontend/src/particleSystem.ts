import * as THREE from 'three';
import { GraphStateSerialized, WalletNodeData } from './wsClient';

// ============================================================
// PATIENT ZERO — Particle System
// Each wallet = a glowing bioluminescent particle
// ============================================================

// Color thresholds match the blueprint
// Color thresholds match the blueprint
const COLOR_ORIGINATOR = new THREE.Color(0x00ffff); // bright cyan — score > 0.7
const COLOR_MIXED       = new THREE.Color(0x00ffa8); // medium green-cyan
const COLOR_FOLLOWER    = new THREE.Color(0x008f3c); // brighter dim green
const COLOR_FLASH       = new THREE.Color(0xffffff); // white flash — new pair

function scoreToColor(score: number): THREE.Color {
  if (score >= 0.7) return COLOR_ORIGINATOR.clone();
  if (score >= 0.4) return COLOR_MIXED.clone();
  return COLOR_FOLLOWER.clone();
}

function scoreToRadius(score: number): number {
  return 1.2 + score * 3.5;
}

/** Stable 3D position from wallet address string */
function walletToPosition(address: string, score: number): THREE.Vector3 {
  // Hash address to a stable angle + radius
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = (hash * 31 + address.charCodeAt(i)) >>> 0;
  }
  const theta = (hash % 3600) / 3600 * Math.PI * 2;
  const phi   = ((hash >> 12) % 1800) / 1800 * Math.PI;
  // High scorers closer to center, followers pushed out
  const r = 20 + (1 - score) * 80 + Math.sin(hash) * 10;
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    (score - 0.5) * 60 + Math.cos(phi) * 20,
    r * Math.sin(phi) * Math.sin(theta)
  );
}

interface ParticleEntry {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  address: string;
  score: number;
  targetPosition: THREE.Vector3;
}

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: Map<string, ParticleEntry> = new Map();
  private glowTexture: THREE.Texture;
  private time = 0;
  private flashes: Array<{ mesh: THREE.Mesh; age: number }> = [];

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

  update(state: GraphStateSerialized, delta: number): void {
    this.time += delta;
    const nodeMap = new Map<string, WalletNodeData>(state.nodes);

    // Add or update particles
    for (const [address, nodeData] of nodeMap) {
      const score = nodeData.originatorScore;
      const color = scoreToColor(score);
      const targetPos = walletToPosition(address, score);

      if (!this.particles.has(address)) {
        // Create new particle
        const radius = scoreToRadius(score);
        const geo = new THREE.SphereGeometry(radius, 8, 8);
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(targetPos);

        // Glow sprite
        const glowMat = new THREE.SpriteMaterial({
          map: this.glowTexture,
          color,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
        });
        const glow = new THREE.Sprite(glowMat);
        glow.scale.set(radius * 6, radius * 6, 1);
        glow.position.copy(targetPos);

        this.scene.add(mesh);
        this.scene.add(glow);

        this.particles.set(address, { mesh, glow, address, score, targetPosition: targetPos });
      } else {
        // Update existing
        const entry = this.particles.get(address)!;
        entry.score = score;
        entry.targetPosition.copy(targetPos);

        // Lerp to new position smoothly
        entry.mesh.position.lerp(targetPos, delta * 0.5);
        entry.glow.position.copy(entry.mesh.position);

        // Update color
        (entry.mesh.material as THREE.MeshBasicMaterial).color.copy(color);
        (entry.glow.material as THREE.SpriteMaterial).color.copy(color);

        // Pulse glow opacity
        const idx = [...this.particles.keys()].indexOf(address);
        const pulse = 0.2 + 0.15 * Math.sin(this.time * 1.5 + idx * 0.7);
        (entry.glow.material as THREE.SpriteMaterial).opacity = pulse;

        // Gentle float
        entry.mesh.position.y += Math.sin(this.time * 0.8 + idx * 0.4) * 0.02;
      }
    }

    // Remove particles for wallets no longer in state
    for (const [address, entry] of this.particles) {
      if (!nodeMap.has(address)) {
        this.scene.remove(entry.mesh);
        this.scene.remove(entry.glow);
        this.particles.delete(address);
      }
    }

    // Animate flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += delta;
      const scale = 1 + f.age * 30;
      f.mesh.scale.set(scale, scale, scale);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity =
        Math.max(0, 1 - f.age * 3);
      if (f.age > 1) {
        this.scene.remove(f.mesh);
        this.flashes.splice(i, 1);
      }
    }
  }

  flashNewPair(position?: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(1, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: COLOR_FLASH,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position ?? new THREE.Vector3(0, 0, 0));
    this.scene.add(mesh);
    this.flashes.push({ mesh, age: 0 });
  }

  getPositions(): Map<string, THREE.Vector3> {
    const map = new Map<string, THREE.Vector3>();
    for (const [addr, entry] of this.particles) {
      map.set(addr, entry.mesh.position.clone());
    }
    return map;
  }
}
