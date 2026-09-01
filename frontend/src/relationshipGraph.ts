import * as THREE from 'three';

// ============================================================
// PATIENT ZERO - Relationship Graph (Blueprint 4.0)
// Interactive draggable particle graph showing wallet relationships.
// Fixes: edges follow nodes on drag, wallet address tooltips on hover/click.
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
  /** Indices into this.edges[] that are connected to this particle */
  edgeIndices: number[];
  /** 'from' or 'to' role in each connected edge */
  edgeRoles: ('from' | 'to')[];
}

interface GraphEdge {
  line: THREE.Line;
  fromParticleIndex: number;
  toParticleIndex: number;
}

export class RelationshipGraph {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private particles: GraphParticle[] = [];
  private edges: GraphEdge[] = [];
  private walletPositions: Map<string, THREE.Vector3> = new Map();
  private time = 0;
  private visible = false;

  // Drag state
  private dragging: GraphParticle | null = null;
  private dragPlane: THREE.Plane;
  private dragOffset: THREE.Vector3 = new THREE.Vector3();
  private camera: THREE.Camera;

  // Tooltip DOM element (created once, reused)
  private tooltip: HTMLDivElement;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.tooltip = this.createTooltip();
  }

  private createTooltip(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'graph-node-tooltip';
    el.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'display:none',
      'background:rgba(0,10,20,0.92)',
      'border:1px solid rgba(0,255,200,0.4)',
      'color:#00ffcc',
      'font-family:monospace',
      'font-size:11px',
      'padding:6px 10px',
      'border-radius:4px',
      'z-index:100',
      'max-width:260px',
      'white-space:nowrap',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  // ── Public: show/hide tooltip (called by main.ts on mousemove) ──────────────

  showTooltip(wallet: string, interactionCount: number, strength: number, x: number, y: number): void {
    const snippet = wallet.slice(0, 8) + '...' + wallet.slice(-4);
    const bars = '█'.repeat(Math.round(strength * 5));
    this.tooltip.innerHTML =
      `<div style="color:#00ffff;font-weight:bold;margin-bottom:3px">${snippet}</div>` +
      `<div style="color:rgba(0,255,200,0.7);font-size:10px">Interactions: ${interactionCount} &nbsp; Strength: ${bars}</div>` +
      `<div style="color:rgba(255,255,255,0.4);font-size:9px;margin-top:3px">Click to see full address</div>`;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = (x + 14) + 'px';
    this.tooltip.style.top  = (y + 14) + 'px';
  }

  hideTooltip(): void {
    this.tooltip.style.display = 'none';
  }

  /** Returns the wallet address of the particle hit by the raycaster, or null */
  getHoveredWallet(raycaster: THREE.Raycaster): { wallet: string; interactionCount: number; strength: number } | null {
    const meshes = this.particles.map(p => p.mesh);
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length === 0) return null;
    const mesh = hits[0].object as THREE.Mesh;
    const p = this.particles.find(p2 => p2.mesh === mesh);
    if (!p) return null;
    return {
      wallet: p.wallet,
      interactionCount: mesh.userData.interactionCount as number ?? 0,
      strength: p.strength
    };
  }

  // ── Graph loading ────────────────────────────────────────────

  loadGraph(data: RelationshipData): void {
    this.clear();
    this.visible = true;

    const centerWallet = data.wallet;
    const nodes = data.relationships.nodes;

    // Center node = analyzed wallet
    const centerPos = new THREE.Vector3(0, 0, 0);
    this.walletPositions.set(centerWallet, centerPos);
    this.createParticle(centerWallet, centerPos, 1.0, 0x00ffff, 2.5, 0); // center: cyan

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

      let color = 0x004d20;
      if (node.interaction_count >= 5) color = 0x00ffff;
      else if (node.interaction_count >= 2) color = 0x00ff80;

      this.createParticle(
        node.wallet, pos, node.relationship_strength, color,
        1.2 + node.relationship_strength * 1.5,
        node.interaction_count
      );
    });

    // Edges (built after all particles exist so we have indices)
    this.buildEdges(centerWallet, data);

    // Animate: fade particles in one-by-one
    this.animateFormation();
  }

  private createParticle(
    wallet: string,
    position: THREE.Vector3,
    strength: number,
    color: number,
    radius: number,
    interactionCount: number
  ): void {
    const geo = new THREE.SphereGeometry(radius, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.userData.wallet = wallet;
    mesh.userData.interactionCount = interactionCount;

    this.group.add(mesh);
    this.particles.push({ mesh, wallet, strength, velocity: new THREE.Vector3(), edgeIndices: [], edgeRoles: [] });
  }

  private buildEdges(centerWallet: string, data: RelationshipData): void {
    const centerIdx = this.particles.findIndex(p => p.wallet === centerWallet);

    data.relationships.nodes.forEach(node => {
      const fromPos = this.walletPositions.get(centerWallet);
      const toPos   = this.walletPositions.get(node.wallet);
      if (!fromPos || !toPos) return;

      const toIdx = this.particles.findIndex(p => p.wallet === node.wallet);
      if (toIdx === -1) return;

      // Build line geometry with Float32Array so positions are mutable
      const positions = new Float32Array(6); // 2 points × 3 coords
      positions[0] = fromPos.x; positions[1] = fromPos.y; positions[2] = fromPos.z;
      positions[3] = toPos.x;   positions[4] = toPos.y;   positions[5] = toPos.z;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const mat = new THREE.LineBasicMaterial({
        color: 0x00ff80,
        transparent: true,
        opacity: 0,
      });

      const line = new THREE.Line(geo, mat);
      this.group.add(line);

      const edgeIdx = this.edges.length;
      this.edges.push({ line, fromParticleIndex: centerIdx, toParticleIndex: toIdx });

      // Register edge in both connected particles
      if (centerIdx !== -1) {
        this.particles[centerIdx].edgeIndices.push(edgeIdx);
        this.particles[centerIdx].edgeRoles.push('from');
      }
      this.particles[toIdx].edgeIndices.push(edgeIdx);
      this.particles[toIdx].edgeRoles.push('to');
    });
  }

  // ── Update edge positions when a node moves ──────────────────

  private refreshEdgesForParticle(particle: GraphParticle): void {
    const pos = particle.mesh.position;
    for (let k = 0; k < particle.edgeIndices.length; k++) {
      const edgeIdx  = particle.edgeIndices[k];
      const role     = particle.edgeRoles[k];
      const edge     = this.edges[edgeIdx];
      const attr     = edge.line.geometry.attributes.position as THREE.BufferAttribute;
      const arr      = attr.array as Float32Array;

      if (role === 'from') {
        arr[0] = pos.x; arr[1] = pos.y; arr[2] = pos.z;
      } else {
        arr[3] = pos.x; arr[4] = pos.y; arr[5] = pos.z;
      }
      attr.needsUpdate = true;
    }
  }

  // ── Formation animation ───────────────────────────────────────

  private animateFormation(): void {
    this.particles.forEach((p, i) => {
      const delay = i * 120;
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

    setTimeout(() => {
      this.edges.forEach(edge => {
        const mat = edge.line.material as THREE.LineBasicMaterial;
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

  // ── Per-frame update ──────────────────────────────────────────

  update(delta: number): void {
    if (!this.visible) return;
    this.time += delta;

    // Gentle float for non-dragged particles + live edge sync
    this.particles.forEach((p, i) => {
      if (p === this.dragging) return;
      p.mesh.position.y += Math.sin(this.time * 0.8 + i * 0.6) * 0.015;
      this.refreshEdgesForParticle(p);
    });

    // Pulse edge opacity
    this.edges.forEach((edge, i) => {
      const mat = edge.line.material as THREE.LineBasicMaterial;
      mat.opacity = 0.15 + 0.15 * Math.sin(this.time * 1.2 + i * 0.4);
    });
  }

  // ── Dragging ──────────────────────────────────────────────────

  startDrag(mesh: THREE.Mesh, raycaster: THREE.Raycaster): void {
    const particle = this.particles.find(p => p.mesh === mesh);
    if (!particle) return;
    this.dragging = particle;
    this.hideTooltip();

    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(this.dragPlane, intersection);
    this.dragOffset.copy(intersection).sub(mesh.position);
  }

  moveDrag(raycaster: THREE.Raycaster): void {
    if (!this.dragging) return;
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(this.dragPlane, intersection);
    this.dragging.mesh.position.copy(intersection.sub(this.dragOffset));

    // Bug 2 fix: update all edges connected to the dragged particle
    this.refreshEdgesForParticle(this.dragging);
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
    for (const e of this.edges) this.group.remove(e.line);
    this.particles = [];
    this.edges = [];
    this.walletPositions.clear();
    this.visible = false;
    this.hideTooltip();
  }
}
