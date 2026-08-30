import { BioluminescentScene } from './scene';
import { ParticleSystem } from './particleSystem';
import { EdgeRenderer } from './edgeRenderer';
import { audioManager } from './audioManager';
import { wsClient, GraphStateSerialized } from './wsClient';

// ============================================================
// PATIENT ZERO — Main Entry Point
// ============================================================

const container = document.getElementById('canvas-container')!;

// Scene
const biolumScene = new BioluminescentScene(container);
const threeScene  = biolumScene.getScene();

// Systems
const particleSystem = new ParticleSystem(threeScene);
const edgeRenderer   = new EdgeRenderer(threeScene);

// State
let latestState: GraphStateSerialized | null = null;
let lastPairCount = 0;
let audioStarted = false;

// ── WebSocket ─────────────────────────────────────────────────
wsClient.onUpdate((state) => {
  latestState = state;
  updateHUD(state);

  // Detect new pair launches
  if (state.stats.totalPairs > lastPairCount) {
    particleSystem.flashNewPair();
    audioManager.triggerNewPairSound();
    lastPairCount = state.stats.totalPairs;
  }

  // Scale audio intensity to active nodes
  const intensity = Math.min(state.stats.totalNodes / 20, 1);
  audioManager.setIntensity(intensity);
});

wsClient.connect();

// ── HUD Update ─────────────────────────────────────────────────
function updateHUD(state: GraphStateSerialized): void {
  const el = (id: string) => document.getElementById(id);
  const nodes = el('stat-nodes');
  const pairs = el('stat-pairs');
  const edges = el('stat-edges');
  const topWallet = el('stat-top-wallet');

  if (nodes) nodes.textContent = String(state.stats.totalNodes);
  if (pairs) pairs.textContent = String(state.stats.totalPairs);
  if (edges) edges.textContent = String(state.stats.totalEdges);

  const top = state.stats.topOriginators[0];
  if (topWallet && top) {
    topWallet.textContent = `${top.address.slice(0, 8)}…${top.address.slice(-4)} (${(top.score * 100).toFixed(1)}%)`;
  }
}

// ── Audio unlock on first click ────────────────────────────────
document.addEventListener(
  'click',
  () => {
    if (!audioStarted) {
      audioManager.start();
      audioStarted = true;
    }
  },
  { once: true }
);

// ── Animation Loop ─────────────────────────────────────────────
function animate(): void {
  requestAnimationFrame(animate);

  const delta = biolumScene.getDelta();
  biolumScene.update(delta);

  if (latestState) {
    particleSystem.update(latestState, delta);
    const positions = particleSystem.getPositions();
    edgeRenderer.update(latestState, positions, delta);
  }

  biolumScene.render();
}

animate();
