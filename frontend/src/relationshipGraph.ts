import * as THREE from 'three';

// ============================================================
// PATIENT ZERO - Relationship Graph (Phase 3)
// Interactive draggable particle graph showing wallet relationships
// ============================================================

export interface RelationshipNode {
  wallet: string;
  interaction_count: number;
  relationship_strength: number;
}

export interface RelationshipData {
  wallet: string;
  relationships: {
    nodes: RelationshipNode[];
    edges: { from_wallet: string; to_wallet: string; strength: number }[];
  };
}

interface GraphParticle {
  mesh: THREE.Mesh;
  wallet: string;
  strength: number;
  velocity: THREE.Vector3;
}

export class RelationshipGraph {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private particles: GraphParticle[] = [];
  private edges: THREE.Line[] = [];
  private walletPositions: Map<string, THREE.Vector3> = new Map();
  private time = 0;
  private visible = false;

  // Drag state
  private dragging: GraphParticle | null = null;
  private dragPlane: THREE.Plane;
  private dragOffset: THREE.Vector3 = new THREE.Vector3();
  private camera: THREE.Camera;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  }

  loadGraph(data: RelationshipData): void {
    this.clear();
    this.visible = true;

    const centerWallet = data.wallet;
    const nodes = data.relationships.nodes;

    // Center node = analyzed wallet
    const centerPos = new THREE.Vector3(0, 0, 0);
    this.walletPositions.set(centerWallet, centerPos);
    this.createParticle(centerWallet, centerPos, 1.0, 0x00ffff, 2.5); // biggest, cyan

    // Related wallets — arranged in a ring with jitter
    const count = nodes.length;
    nodes.forEach((node, i) => {
      const angle = (i / count) * Math.PI * 2;
      const radius = 25 + Math.random() * 10;
      const pos = new THREE.Vector3(
        Math.cos(angle) * radius,
        (Math.random() - 0.5) * 15,
        Math.sin(angle) * radius
      );
      this.walletPositions.set(node.wallet, pos);

      // Color by strength
      let color = 0x004d20;
      if (node.interaction_count >= 5) color = 0x00ffff;
      else if (node.interaction_count >= 2) color = 0x00ff80;

      this.createParticle(node.wallet, pos, node.relationship_strength, color, 1.2 + node.relationship_strength * 1.5);
    });

    // Edges
    this.buildEdges(centerWallet, data);

    // Animate: fade particles in one-by-one
    this.animateFormation();
  }

  private createParticle(
    wallet: string,
    position: THREE.Vector3,
    strength: number,
    color: number,
    radius: number
  ): void {
    const geo = new THREE.SphereGeometry(radius, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,  // start invisible — animated in
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.userData.wallet = wallet;

    this.group.add(mesh);
    this.particles.push({ mesh, wallet, strength, velocity: new THREE.Vector3() });
  }

  private buildEdges(centerWallet: string, data: RelationshipData): void {
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff80,
      transparent: true,
      opacity: 0,
    });

    data.relationships.nodes.forEach(node => {
      const from = this.walletPositions.get(centerWallet);
      const to = this.walletPositions.get(node.wallet);
      if (!from || !to) return;

      const points = [from.clone(), to.clone()];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, material.clone());
      this.group.add(line);
      this.edges.push(line);
    });
  }

  private animateFormation(): void {
    // Stagger particle fade-in
    this.particles.forEach((p, i) => {
      const delay = i * 120; // ms
      setTimeout(() => {
        const mat = p.mesh.material as THREE.MeshBasicMaterial;
        const target = i === 0 ? 1.0 : 0.85;
        let opacity = 0;
        const step = () => {
          opacity = Math.min(target, opacity + 0.05);
          mat.opacity = opacity;
          if (opacity < target) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, delay);
    });

    // Fade in edges after particles are visible
    setTimeout(() => {
      this.edges.forEach(line => {
        const mat = line.material as THREE.LineBasicMaterial;
        let opacity = 0;
        const step = () => {
          opacity = Math.min(0.3, opacity + 0.02);
          mat.opacity = opacity;
          if (opacity < 0.3) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, this.particles.length * 120 + 200);
  }

  update(delta: number): void {
    if (!this.visible) return;
    this.time += delta;

    // Gentle float for non-dragged particles
    this.particles.forEach((p, i) => {
      if (p === this.dragging) return;
      p.mesh.position.y += Math.sin(this.time * 0.8 + i * 0.6) * 0.015;
    });

    // Pulse edge opacity
    this.edges.forEach((line, i) => {
      const mat = line.material as THREE.LineBasicMaterial;
      mat.opacity = 0.15 + 0.15 * Math.sin(this.time * 1.2 + i * 0.4);
    });
  }

  // ── Dragging ────────────────────────────────────────────────

  startDrag(mesh: THREE.Mesh, raycaster: THREE.Raycaster): void {
    const particle = this.particles.find(p => p.mesh === mesh);
    if (!particle) return;
    this.dragging = particle;

    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(this.dragPlane, intersection);
    this.dragOffset.copy(intersection).sub(mesh.position);
  }

  moveDrag(raycaster: THREE.Raycaster): void {
    if (!this.dragging) return;
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(this.dragPlane, intersection);
    this.dragging.mesh.position.copy(intersection.sub(this.dragOffset));
  }

  endDrag(): void {
    this.dragging = null;
  }

  getMeshes(): THREE.Mesh[] {
    return this.particles.map(p => p.mesh);
  }

  isVisible(): boolean {
    return this.visible;
  }

  clear(): void {
    for (const p of this.particles) this.group.remove(p.mesh);
    for (const line of this.edges) this.group.remove(line);
    this.particles = [];
    this.edges = [];
    this.walletPositions.clear();
    this.visible = false;
  }
}
