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

// ── Wallet Lookup Logic ────────────────────────────────────────
const lookupBtn = document.getElementById('lookup-btn');
const lookupInput = document.getElementById('lookup-input') as HTMLInputElement;
const lookupResult = document.getElementById('lookup-result');
const valClass = document.getElementById('lookup-class');
const valOrig = document.getElementById('lookup-orig-score');
const valFoll = document.getElementById('lookup-foll-score');
const valPairs = document.getElementById('lookup-pairs');

if (lookupBtn && lookupInput && lookupResult && valClass && valOrig && valFoll && valPairs) {
  lookupBtn.addEventListener('click', () => {
    const address = lookupInput.value.trim();
    if (!address || !latestState) return;

    // Find wallet in state (nodes is Array<[address, WalletNode]>)
    const walletData = latestState.nodes.find(([addr]) => addr === address);

    if (walletData) {
      const node = walletData[1];
      const oScore = node.originatorScore;
      const fScore = node.followerScore;
      const totalPairs = node.timingPattern.totalPairs;

      // Classification based on thresholds
      let classification = 'Follower / Copycat';
      let cssClass = 'score-low';
      
      if (oScore > 0.7) {
        classification = 'Genuine Originator';
        cssClass = 'score-high';
      } else if (oScore > 0.4) {
        classification = 'Mixed / Neutral';
        cssClass = 'score-med';
      }

      valClass.textContent = classification;
      valClass.className = cssClass;
      valOrig.textContent = (oScore * 100).toFixed(1) + '%';
      valOrig.className = cssClass;
      valFoll.textContent = (fScore * 100).toFixed(1) + '%';
      valPairs.textContent = totalPairs.toString();
      
      lookupResult.style.display = 'block';
    } else {
      valClass.textContent = 'Not found in active memory';
      valClass.className = 'score-low';
      valOrig.textContent = '—';
      valFoll.textContent = '—';
      valPairs.textContent = '—';
      lookupResult.style.display = 'block';
    }
  });

  // Allow enter key to trigger lookup
  lookupInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') lookupBtn.click();
  });
}

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
