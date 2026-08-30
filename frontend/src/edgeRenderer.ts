import * as THREE from 'three';
import { GraphStateSerialized } from './wsClient';

// ============================================================
// PATIENT ZERO — Edge Renderer
// Draws cascade flow lines between wallet particles
// ============================================================

const COLOR_ORIGIN   = new THREE.Color(0x00c8ff); // bright cyan trail
const COLOR_FOLLOWER = new THREE.Color(0x006432); // dim green trail

interface EdgeEntry {
  line: THREE.Line;
  dot: THREE.Mesh;
  dotProgress: number; // 0–1
  dotSpeed: number;    // progress units per second
}

export class EdgeRenderer {
  private scene: THREE.Scene;
  private edges: Map<string, EdgeEntry> = new Map();
  private dotGeo: THREE.SphereGeometry;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.dotGeo = new THREE.SphereGeometry(0.4, 6, 6);
  }

  update(
    state: GraphStateSerialized,
    nodePositions: Map<string, THREE.Vector3>,
    delta: number
  ): void {
    this.time += delta;

    const activeKeys = new Set<string>();

    for (const edge of state.edges) {
      if (edge.edgeType === 'coincidence') continue;

      const fromPos = nodePositions.get(edge.fromWallet);
      const toPos   = nodePositions.get(edge.toWallet);
      if (!fromPos || !toPos) continue;

      const key = `${edge.fromWallet}:${edge.toWallet}`;
      activeKeys.add(key);

      const color = edge.edgeType === 'origin' ? COLOR_ORIGIN : COLOR_FOLLOWER;
      const opacity = edge.edgeType === 'origin' ? 0.5 : 0.2;

      if (!this.edges.has(key)) {
        // Create line
        const geo = new THREE.BufferGeometry().setFromPoints([
          fromPos.clone(),
          toPos.clone(),
        ]);
        const mat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
        });
        const line = new THREE.Line(geo, mat);

        // Create travelling dot
        const dotMat = new THREE.MeshBasicMaterial({
          color: COLOR_ORIGIN,
          transparent: true,
          opacity: 0.9,
        });
        const dot = new THREE.Mesh(this.dotGeo, dotMat);

        this.scene.add(line);
        this.scene.add(dot);

        this.edges.set(key, {
          line,
          dot,
          dotProgress: Math.random(), // stagger starts
          dotSpeed: 0.2 + Math.random() * 0.2,
        });
      }

      const entry = this.edges.get(key)!;

      // Update line endpoint positions (nodes drift)
      const positions = entry.line.geometry.attributes.position as THREE.BufferAttribute;
      positions.setXYZ(0, fromPos.x, fromPos.y, fromPos.z);
      positions.setXYZ(1, toPos.x,   toPos.y,   toPos.z);
      positions.needsUpdate = true;

      // Advance travelling dot
      entry.dotProgress = (entry.dotProgress + delta * entry.dotSpeed) % 1;
      const dotPos = fromPos.clone().lerp(toPos, entry.dotProgress);
      entry.dot.position.copy(dotPos);

      // Pulse dot opacity
      (entry.dot.material as THREE.MeshBasicMaterial).opacity =
        0.6 + 0.4 * Math.sin(this.time * 4 + entry.dotProgress * Math.PI * 2);
    }

    // Remove stale edges
    for (const [key, entry] of this.edges) {
      if (!activeKeys.has(key)) {
        this.scene.remove(entry.line);
        this.scene.remove(entry.dot);
        this.edges.delete(key);
      }
    }
  }
}
