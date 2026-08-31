import * as THREE from 'three';
import { BioluminescentScene } from './scene';
import { ParticleSystem } from './particleSystem';
import { EdgeRenderer } from './edgeRenderer';
import { Mode2Scene } from './mode2Scene';
import { audioManager } from './audioManager';
import { wsClient, GraphStateSerialized } from './wsClient';
import { appState, TokenAnalysisResult, WalletAnalysisResult, WalletBriefing } from './appState';

// ============================================================
// PATIENT ZERO — Main Entry Point & UI Controller
// ============================================================

const container = document.getElementById('canvas-container')!;

// Scene
const biolumScene = new BioluminescentScene(container);
const threeScene  = biolumScene.getScene();
const camera = biolumScene.getCamera();

// Systems
const particleSystem = new ParticleSystem(threeScene);
const edgeRenderer   = new EdgeRenderer(threeScene);
const mode2Scene     = new Mode2Scene(threeScene);

// State
let latestState: GraphStateSerialized | null = null;
let lastPairCount = 0;
let audioStarted = false;

// Always use the Render backend for REST calls since the app is deployed on Vercel
const API_URL = 'https://patient-zero-backend.onrender.com/api';

// ── DOM Elements ──────────────────────────────────────────────
const btnMode1 = document.getElementById('btn-mode1')!;
const btnMode2 = document.getElementById('btn-mode2')!;
const hudStats = document.getElementById('hud-stats')!;
const legend = document.getElementById('legend')!;
const mode2InputPanel = document.getElementById('mode2-input')!;
const summaryPanel = document.getElementById('summary-panel')!;
const briefingPanel = document.getElementById('briefing-panel')!;
const briefingContent = document.getElementById('briefing-content')!;
const briefingClose = document.getElementById('briefing-close')!;

const analysisInput = document.getElementById('analysis-input') as HTMLInputElement;
const analysisBtn = document.getElementById('analysis-btn') as HTMLButtonElement;
const analysisReset = document.getElementById('analysis-reset') as HTMLButtonElement;
const analysisError = document.getElementById('analysis-error')!;

// ── WebSocket ─────────────────────────────────────────────────
wsClient.onUpdate((state) => {
  latestState = state;
  updateHUD(state);

  if (state.stats.totalPairs > lastPairCount) {
    if (appState.mode === 'ecosystem') {
      particleSystem.flashNewPair();
    }
    audioManager.triggerNewPairSound();
    lastPairCount = state.stats.totalPairs;
  }

  const intensity = Math.min(state.stats.totalNodes / 20, 1);
  audioManager.setIntensity(intensity);
});

wsClient.connect();

// ── HUD Update ────────────────────────────────────────────────
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

// ── Audio unlock & Visibility Hook ────────────────────────────
document.addEventListener('click', () => {
  if (!audioStarted) {
    audioManager.start();
    audioStarted = true;
  }
}, { once: true });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    wsClient.disconnect();
    if (audioStarted) audioManager.stop();
  } else if (document.visibilityState === 'visible') {
    wsClient.connect();
    if (audioStarted) audioManager.start();
  }
});

// ── Mode Switching ────────────────────────────────────────────
btnMode1.addEventListener('click', () => appState.setMode('ecosystem'));
btnMode2.addEventListener('click', () => appState.setMode('analysis'));

appState.on(() => {
  // Update Buttons
  btnMode1.className = appState.mode === 'ecosystem' ? 'mode-btn active' : 'mode-btn';
  btnMode2.className = appState.mode === 'analysis' ? 'mode-btn active' : 'mode-btn';

  // Toggle UI visibility
  if (appState.mode === 'ecosystem') {
    hudStats.style.display = 'block';
    legend.style.display = 'block';
    mode2InputPanel.classList.add('hidden');
    summaryPanel.classList.add('hidden');
    briefingPanel.classList.add('hidden');
    analysisError.style.display = 'none';

    particleSystem.setVisible(true);
    edgeRenderer.setVisible(true);
    mode2Scene.clear();
  } else {
    hudStats.style.display = 'none';
    legend.style.display = 'none';
    mode2InputPanel.classList.remove('hidden');
    
    particleSystem.setVisible(false);
    edgeRenderer.setVisible(false);

    if (appState.analysisType === 'wallet' && appState.analysisResult) {
      renderWalletSummary(appState.analysisResult as WalletAnalysisResult);
      summaryPanel.classList.remove('hidden');
      mode2Scene.clear();
    } else if (appState.analysisType === 'token' && appState.analysisResult) {
      mode2Scene.renderTokenAnalysis(appState.analysisResult as TokenAnalysisResult);
      summaryPanel.classList.add('hidden');
    } else {
      summaryPanel.classList.add('hidden');
      mode2Scene.clear();
    }
  }

  // Update button state
  analysisBtn.disabled = appState.isLoading;
  analysisBtn.textContent = appState.isLoading ? 'Loading...' : 'Analyze';

  // Show error
  if (appState.error) {
    analysisError.textContent = appState.error;
    analysisError.style.display = 'block';
  } else {
    analysisError.style.display = 'none';
  }
});

// ── Mode 2 Input Form ─────────────────────────────────────────
analysisBtn.addEventListener('click', async () => {
  const address = analysisInput.value.trim();
  if (!address) return;

  const typeRadios = document.getElementsByName('analysisType');
  let type = 'wallet';
  for (let i = 0; i < typeRadios.length; i++) {
    if ((typeRadios[i] as HTMLInputElement).checked) {
      type = (typeRadios[i] as HTMLInputElement).value;
    }
  }

  appState.setLoading(true);
  briefingPanel.classList.add('hidden');

  try {
    const res = await fetch(`${API_URL}/analyze/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [`${type}_address`]: address })
    });
    const data = await res.json();

    if (!res.ok) {
      appState.setError(data.error || 'Failed to analyze address');
      return;
    }

    appState.setAnalysisResult(type as 'wallet' | 'token', address, data);
  } catch (err) {
    appState.setError('Network error. Please try again.');
  }
});

analysisReset.addEventListener('click', () => {
  analysisInput.value = '';
  appState.reset();
});

analysisInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') analysisBtn.click();
});

function renderWalletSummary(res: WalletAnalysisResult): void {
  const stats = res.leadership_stats;
  let historyHtml = res.discovery_history.map(h => `
    <div class="history-item">
      <div><span style="color:#00ffff">${h.token_symbol}</span> (${h.token_address.slice(0,6)}…)</div>
      <div style="color:rgba(0,255,200,0.6)">Position: #${h.position} | Score: ${(h.originator_score*100).toFixed(1)}%</div>
    </div>
  `).join('');

  if (!historyHtml) historyHtml = '<div class="history-item" style="color:rgba(255,255,255,0.4)">No originator discoveries found.</div>';

  summaryPanel.innerHTML = `
    <h3>Wallet Leadership Summary</h3>
    <div class="summary-stat"><span>Classification:</span> <span style="color:#00ffff">${res.classification.replace('_', ' ').toUpperCase()}</span></div>
    <div class="summary-stat"><span>Coins Led:</span> <span>${stats.coins_led}</span></div>
    <div class="summary-stat"><span>Top 5 Appearances:</span> <span>${stats.top_5_appearances}</span></div>
    <div class="summary-stat"><span>Avg Originator Score:</span> <span>${(stats.avg_originator_score * 100).toFixed(1)}%</span></div>
    <div class="summary-stat"><span>Network Centrality:</span> <span>${(stats.network_centrality * 100).toFixed(1)}%</span></div>
    <div class="summary-stat"><span>Follower Ratio:</span> <span>${(stats.follower_ratio * 100).toFixed(1)}%</span></div>
    
    <h3 style="margin-top: 24px; font-size: 11px;">Discovery History</h3>
    <div class="history-list">
      ${historyHtml}
    </div>
  `;
}

// ── Raycaster (Particle Click) ────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

document.addEventListener('click', async (e) => {
  if (appState.mode !== 'analysis' || appState.analysisType !== 'token') return;

  // Don't trigger if clicking on UI
  if ((e.target as HTMLElement).closest('#mode2-input, #summary-panel, #briefing-panel, #mode-toggle')) {
    return;
  }

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(mode2Scene.getMeshes());

  if (intersects.length > 0) {
    const mesh = intersects[0].object;
    const wallet = mesh.userData.wallet;
    if (wallet) {
      await fetchAndShowBriefing(wallet, e.clientX, e.clientY);
    }
  }
});

briefingClose.addEventListener('click', () => {
  briefingPanel.classList.add('hidden');
});

async function fetchAndShowBriefing(wallet: string, x: number, y: number) {
  try {
    const res = await fetch(`${API_URL}/wallet/${wallet}/briefing`);
    if (!res.ok) return;
    const data: WalletBriefing = await res.json();

    briefingContent.innerHTML = `
      <div style="font-size:14px;color:#00ffff;margin-bottom:8px;font-weight:bold;">${data.wallet_snippet}</div>
      <div style="font-size:11px;color:#00ffcc;margin-bottom:12px;text-transform:uppercase;">${data.classification}</div>
      
      <div style="font-size:11px;margin-bottom:4px;display:flex;justify-content:space-between;">
        <span style="color:rgba(0,255,200,0.6)">Originator Score:</span>
        <span style="color:#00ffff">${(data.originator_score * 100).toFixed(1)}%</span>
      </div>
      <div style="font-size:11px;margin-bottom:4px;display:flex;justify-content:space-between;">
        <span style="color:rgba(0,255,200,0.6)">Follower Score:</span>
        <span style="color:#00ffff">${(data.follower_score * 100).toFixed(1)}%</span>
      </div>
      <div style="font-size:11px;margin-bottom:12px;display:flex;justify-content:space-between;">
        <span style="color:rgba(0,255,200,0.6)">Early Purchases:</span>
        <span style="color:#00ffff">${data.early_buyer_count} / ${data.total_pairs} pairs</span>
      </div>
      
      <div style="font-size:10px;color:rgba(0,255,200,0.5);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.1em;">Recent Activity</div>
      ${data.recent_activity.map(a => `
        <div style="font-size:10px;display:flex;justify-content:space-between;border-bottom:1px dashed rgba(0,255,200,0.15);padding:4px 0;">
          <span style="color:#00ffff">${a.symbol}</span>
          <span style="color:rgba(255,255,255,0.6)">Pos #${a.position}</span>
        </div>
      `).join('')}
    `;

    // Position panel near click
    const panelW = 280;
    const panelH = 300; // rough guess
    const left = Math.min(x + 20, window.innerWidth - panelW - 20);
    const top = Math.min(y - 20, window.innerHeight - panelH - 20);
    
    briefingPanel.style.left = `${left}px`;
    briefingPanel.style.top = `${top}px`;
    briefingPanel.classList.remove('hidden');
  } catch (err) {
    console.error("Failed to load briefing", err);
  }
}

// ── Animation Loop ────────────────────────────────────────────
function animate(): void {
  requestAnimationFrame(animate);

  const delta = biolumScene.getDelta();
  biolumScene.update(delta);

  if (appState.mode === 'ecosystem' && latestState) {
    particleSystem.update(latestState, delta);
    edgeRenderer.update(latestState, particleSystem.getPositions(), delta);
  } else if (appState.mode === 'analysis') {
    mode2Scene.update(delta);
  }

  biolumScene.render();
}

animate();
