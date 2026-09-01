import * as THREE from 'three';
import { BioluminescentScene } from './scene';
import { ParticleSystem } from './particleSystem';
import { EdgeRenderer } from './edgeRenderer';
import { Mode2Scene } from './mode2Scene';
import { RelationshipGraph, RelationshipData } from './relationshipGraph';
import { audioManager } from './audioManager';
import { wsClient, GraphStateSerialized } from './wsClient';
import { appState, TokenAnalysisResult, WalletAnalysisResult, WalletBriefing } from './appState';
import { validateSolanaAddress } from './validation';

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
const relationshipGraph = new RelationshipGraph(threeScene, camera);

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
const analysisError = document.getElementById('analysis-error') as HTMLDivElement;
const validationMsg = document.getElementById('addr-validation-msg') as HTMLDivElement;

const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const depthRadios = document.querySelectorAll('input[name="analysisDepth"]');
const advancedWarning = document.getElementById('advanced-warning') as HTMLDivElement;

depthRadios.forEach(r => r.addEventListener('change', (e) => {
  const val = (e.target as HTMLInputElement).value;
  advancedWarning.style.display = val === 'advanced' ? 'block' : 'none';
}));

const shareCardPanel = document.getElementById('share-card-panel') as HTMLElement;
const btnShareImage = document.getElementById('btn-share-image') as HTMLButtonElement;
const btnShareText = document.getElementById('btn-share-text') as HTMLButtonElement;
const shareCanvas = document.getElementById('share-canvas') as HTMLCanvasElement;

const btnExploreGraph = document.getElementById('btn-explore-graph') as HTMLButtonElement;
const btnCloseGraph = document.getElementById('btn-close-graph') as HTMLButtonElement;
const graphLegend = document.getElementById('graph-legend') as HTMLDivElement;

if (appState.userApiKey) {
  apiKeyInput.value = appState.userApiKey;
}
apiKeyInput.addEventListener('change', (e) => {
  appState.setApiKey((e.target as HTMLInputElement).value);
});

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
    shareCardPanel.classList.add('hidden');
    summaryPanel.classList.add('hidden');
    briefingPanel.classList.add('hidden');
    walletGraphControls.style.display = 'none';
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
      shareCardPanel.classList.remove('hidden');
      walletGraphControls.style.display = 'block';
      mode2Scene.clear();
    } else if (appState.analysisType === 'token' && appState.analysisResult) {
      mode2Scene.renderTokenAnalysis(appState.analysisResult as TokenAnalysisResult);
      summaryPanel.classList.add('hidden');
      shareCardPanel.classList.remove('hidden');
      walletGraphControls.style.display = 'none';
    } else {
      summaryPanel.classList.add('hidden');
      shareCardPanel.classList.add('hidden');
      walletGraphControls.style.display = 'none';
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
analysisInput.addEventListener('input', () => {
  const address = analysisInput.value.trim();
  if (!address) {
    validationMsg.style.display = 'none';
    analysisBtn.disabled = false;
    return;
  }
  const result = validateSolanaAddress(address);
  if (!result.valid) {
    validationMsg.textContent = result.error || 'Invalid address';
    validationMsg.style.display = 'block';
    analysisBtn.disabled = true;
  } else {
    validationMsg.style.display = 'none';
    analysisBtn.disabled = false;
  }
});

analysisBtn.addEventListener('click', async () => {
  const address = analysisInput.value.trim();
  if (!address) return;
  
  const validationResult = validateSolanaAddress(address);
  if (!validationResult.valid) {
    validationMsg.textContent = validationResult.error || 'Invalid address';
    validationMsg.style.display = 'block';
    return;
  }
  
  if (!appState.userApiKey) {
    appState.setError('Helius API key required for analysis');
    return;
  }

  const typeRadios = document.getElementsByName('analysisType');
  let type = 'wallet';
  for (let i = 0; i < typeRadios.length; i++) {
    if ((typeRadios[i] as HTMLInputElement).checked) {
      type = (typeRadios[i] as HTMLInputElement).value;
    }
  }

  const depthRadios = document.getElementsByName('analysisDepth');
  let depth = 'basic';
  for (let i = 0; i < depthRadios.length; i++) {
    if ((depthRadios[i] as HTMLInputElement).checked) {
      depth = (depthRadios[i] as HTMLInputElement).value;
    }
  }

  appState.setLoading(true);
  briefingPanel.classList.add('hidden');
  shareCardPanel.classList.add('hidden');
  walletGraphControls.style.display = 'none';
  relationshipGraph.clear();

  try {
    const res = await fetch(`${API_URL}/analyze/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        [`${type}_address`]: address,
        user_api_key: appState.userApiKey,
        analysis_depth: depth
      })
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
  validationMsg.style.display = 'none';
  analysisBtn.disabled = false;
  relationshipGraph.clear();
  walletGraphControls.style.display = 'none';
  appState.reset();
});

analysisInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') analysisBtn.click();
});

function renderWalletSummary(res: WalletAnalysisResult): void {
  const indicators = res.leadership_indicators;
  let historyHtml = res.recent_activity.map(h => `
    <div class="history-item">
      <div><span style="color:#00ffff">${h.token_name}</span> (${h.token_address.slice(0,6)}.)</div>
      <div style="color:rgba(0,255,200,0.6)">Entry: ${new Date(h.entry_time).toLocaleString()}</div>
    </div>
  `).join('');

  if (!historyHtml) historyHtml = '<div class="history-item" style="color:rgba(255,255,255,0.4)">No recent DEX activity found.</div>';

  let advancedHtml = '';
  if ((res as any).advanced_metrics) {
    const am = (res as any).advanced_metrics;
    advancedHtml = `
      <h3 style="margin-top: 24px; font-size: 11px; color:#ffcc00;">Advanced Metrics</h3>
      <div class="summary-stat"><span>Network Centrality:</span> <span>${(am.network_centrality * 100).toFixed(1)}%</span></div>
      <div class="summary-stat"><span>Cascade Influence:</span> <span style="text-transform:uppercase">${am.cascade_influence}</span></div>
      <div class="summary-stat"><span>Consistency Score:</span> <span>${(am.consistency_score * 100).toFixed(1)}%</span></div>
      <div class="summary-stat"><span>Risk Profile:</span> <span style="text-transform:uppercase">${am.risk_profile}</span></div>
      <div class="summary-stat"><span>Peak Activity:</span> <span>${Math.min(...am.peak_activity_hours)}:00 - ${Math.max(...am.peak_activity_hours)}:00 UTC</span></div>
      <div class="summary-stat"><span>Percentile Rank:</span> <span>Top ${100 - am.percentile_ranking}%</span></div>
    `;
  }

  summaryPanel.innerHTML = `
    <h3>Wallet Leadership Summary</h3>
    <div class="summary-stat"><span>Classification:</span> <span style="color:#00ffff">${res.classification.replace('_', ' ').toUpperCase()}</span></div>
    <div class="summary-stat"><span>Transactions Analyzed:</span> <span>${res.transaction_count}</span></div>
    <div class="summary-stat"><span>Originator Score:</span> <span>${(res.originator_score * 100).toFixed(1)}%</span></div>
    <div class="summary-stat"><span>Confidence:</span> <span>${(res.confidence * 100).toFixed(1)}%</span></div>
    <div class="summary-stat"><span>Early Entry Rate:</span> <span>${(indicators.early_entry_rate * 100).toFixed(1)}%</span></div>
    <div class="summary-stat"><span>Leadership Evidence:</span> <span style="text-transform:uppercase">${indicators.leadership_evidence}</span></div>
    ${advancedHtml}
    
    <h3 style="margin-top: 24px; font-size: 11px;">Recent DEX Activity</h3>
    <div class="history-list">
      ${historyHtml}
    </div>
  `;
}

// Share Generators
btnShareText.addEventListener('click', () => {
  let text = '';
  if (appState.analysisType === 'wallet' && appState.analysisResult) {
    const res = appState.analysisResult as WalletAnalysisResult;
    text = `🧬 **PATIENT ZERO Analysis**\n\n` +
           `**Wallet:** \`${res.wallet_snippet}\`\n` +
           `**Class:** ${res.classification.replace('_', ' ').toUpperCase()}\n` +
           `**Originator Score:** ${(res.originator_score * 100).toFixed(1)}%\n` +
           `*Based on ${res.analysis_basis}*\n\n` +
           `_Analyze wallets for free at bioluminescence.xyz_`;
  } else if (appState.analysisType === 'token' && appState.analysisResult) {
    const res = appState.analysisResult as TokenAnalysisResult;
    const top = res.top_originators.slice(0,3).map(o => `• \`${o.wallet.slice(0,4)}..${o.wallet.slice(-4)}\` (${(o.originator_score*100).toFixed(1)}%)`).join('\n');
    text = `🧬 **PATIENT ZERO Analysis**\n\n` +
           `**Token:** \`${res.token_analysis.token_address.slice(0,8)}...\`\n` +
           `**Top Originators:**\n${top}\n\n` +
           `*Based on ${res.token_analysis.analysis_basis}*\n\n` +
           `_Analyze tokens for free at bioluminescence.xyz_`;
  }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
    btnShareText.textContent = 'Copied!';
    setTimeout(() => btnShareText.textContent = 'Generate Text Card', 2000);
  }
});

btnShareImage.addEventListener('click', () => {
  const ctx = shareCanvas.getContext('2d');
  if (!ctx) return;

  const W = 700, H = 420;
  shareCanvas.width = W;
  shareCanvas.height = H;

  // ── Premium gradient background ──────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0,   '#050d18');
  bgGrad.addColorStop(0.5, '#071620');
  bgGrad.addColorStop(1,   '#030b12');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle grid overlay
  ctx.strokeStyle = 'rgba(0,255,200,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Border glow
  const borderGrad = ctx.createLinearGradient(0, 0, W, H);
  borderGrad.addColorStop(0, 'rgba(0,255,255,0.6)');
  borderGrad.addColorStop(0.5, 'rgba(0,255,120,0.3)');
  borderGrad.addColorStop(1, 'rgba(0,255,255,0.6)');
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // ── Header ───────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,255,200,0.08)';
  ctx.fillRect(0, 0, W, 54);
  ctx.strokeStyle = 'rgba(0,255,200,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 54); ctx.lineTo(W, 54); ctx.stroke();

  ctx.fillStyle = '#00ffff';
  ctx.font = 'bold 15px monospace';
  ctx.fillText('PATIENT ZERO // BIOLUMINESCENCE', 20, 33);

  // Timestamp top-right
  ctx.fillStyle = 'rgba(0,255,200,0.4)';
  ctx.font = '10px monospace';
  const timestamp = new Date().toUTCString().replace(' GMT', ' UTC');
  ctx.fillText(timestamp, W - ctx.measureText(timestamp).width - 16, 33);

  // ── Helper: draw horizontal bar gauge ────────────────────────
  function drawGauge(x: number, y: number, w: number, value: number, color: string, label: string) {
    const pct = Math.max(0, Math.min(1, value));
    // Track
    ctx.fillStyle = 'rgba(0,255,200,0.1)';
    ctx.fillRect(x, y, w, 8);
    // Fill
    const fillGrad = ctx.createLinearGradient(x, 0, x + w * pct, 0);
    fillGrad.addColorStop(0, color);
    fillGrad.addColorStop(1, '#00ff80');
    ctx.fillStyle = fillGrad;
    ctx.fillRect(x, y, w * pct, 8);
    // Label
    ctx.fillStyle = 'rgba(0,255,200,0.6)';
    ctx.font = '9px monospace';
    ctx.fillText(label, x, y - 3);
    // Value
    ctx.fillStyle = '#00ffcc';
    ctx.fillText((pct * 100).toFixed(0) + '%', x + w + 4, y + 7);
  }

  if (appState.analysisType === 'wallet' && appState.analysisResult) {
    const res = appState.analysisResult as WalletAnalysisResult;
    const am = (res as any).advanced_metrics;
    const depth = am ? 'Advanced Analysis (150 tx)' : 'Basic Analysis (50 tx)';
    const snippet = res.wallet_snippet || `${res.wallet?.slice(0,6)}...${res.wallet?.slice(-4)}`;

    // Sub-header
    ctx.fillStyle = 'rgba(0,255,200,0.5)';
    ctx.font = '9px monospace';
    ctx.fillText('WALLET ANALYSIS  //  ' + depth, 20, 72);

    // Wallet address
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(snippet, 20, 92);

    // Classification badge
    const cls = res.classification.replace(/_/g, ' ').toUpperCase();
    const clsColor = res.originator_score >= 0.7 ? '#00ffcc' : (res.originator_score >= 0.4 ? '#ffcc00' : '#ff6666');
    ctx.fillStyle = `${clsColor}22`;
    const bw = ctx.measureText(cls).width + 20;
    ctx.fillRect(20, 100, bw, 20);
    ctx.strokeStyle = clsColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 100, bw, 20);
    ctx.fillStyle = clsColor;
    ctx.font = 'bold 10px monospace';
    ctx.fillText(cls, 30, 114);

    // ── Score gauges ─────────────────────────────────────────────
    const gx = 20, gy = 148, gw = 220;
    drawGauge(gx, gy,       gw, res.originator_score, '#00ffff', 'ORIGINATOR SCORE');
    if (res.confidence !== undefined) drawGauge(gx, gy + 28, gw, res.confidence,       '#00ff80', 'CONFIDENCE');
    if (res.leadership_indicators) {
      drawGauge(gx, gy + 56, gw, res.leadership_indicators.early_entry_rate, '#00ffcc', 'EARLY ENTRY RATE');
    }

    // ── Advanced metrics panel ────────────────────────────────────
    if (am) {
      ctx.fillStyle = 'rgba(255,204,0,0.06)';
      ctx.fillRect(260, 130, 420, 230);
      ctx.strokeStyle = 'rgba(255,204,0,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(260, 130, 420, 230);

      ctx.fillStyle = '#ffcc00';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('ADVANCED METRICS', 272, 148);
      ctx.strokeStyle = 'rgba(255,204,0,0.15)';
      ctx.beginPath(); ctx.moveTo(272, 152); ctx.lineTo(668, 152); ctx.stroke();

      const mx = 272, mw = 160;
      drawGauge(mx, 172, mw, am.network_centrality,  '#ffcc00', 'NETWORK CENTRALITY');
      drawGauge(mx, 200, mw, am.consistency_score,   '#ff9900', 'CONSISTENCY SCORE');
      drawGauge(mx + 190, 172, mw, am.percentile_ranking / 100, '#00ffff', 'PERCENTILE RANK');

      ctx.fillStyle = 'rgba(0,255,200,0.5)';
      ctx.font = '9px monospace';
      ctx.fillText('CASCADE INFLUENCE:', mx, 230);
      ctx.fillText('RISK PROFILE:', mx + 190, 230);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(am.cascade_influence.toUpperCase(), mx, 244);
      ctx.fillText(am.risk_profile.toUpperCase(), mx + 190, 244);

      // Percentile bar (big visual)
      ctx.fillStyle = 'rgba(0,255,200,0.1)';
      ctx.fillRect(mx, 270, 370, 12);
      const pGrad = ctx.createLinearGradient(mx, 0, mx + 370, 0);
      pGrad.addColorStop(0, '#001a0a'); pGrad.addColorStop(1, '#00ffff');
      ctx.fillStyle = pGrad;
      ctx.fillRect(mx, 270, (am.percentile_ranking / 100) * 370, 12);
      ctx.fillStyle = '#00ffcc'; ctx.font = '9px monospace';
      ctx.fillText(`Top ${100 - am.percentile_ranking}% of tracked wallets`, mx, 297);
    }

    // ── Basic stats right panel (no advanced) ──────────────────
    if (!am) {
      ctx.fillStyle = 'rgba(0,255,200,0.5)';
      ctx.font = '9px monospace';
      ctx.fillText('TXS ANALYZED:', 260, 150);
      ctx.fillText('EARLY ENTRY RATE:', 260, 175);
      ctx.fillText('LEADERSHIP EVIDENCE:', 260, 200);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(String(res.transaction_count ?? 50), 260, 165);
      ctx.fillText((res.leadership_indicators?.early_entry_rate * 100 ?? 0).toFixed(1) + '%', 260, 190);
      ctx.fillText((res.leadership_indicators?.leadership_evidence ?? 'N/A').toUpperCase(), 260, 215);
    }

  } else if (appState.analysisType === 'token' && appState.analysisResult) {
    const res = appState.analysisResult as TokenAnalysisResult;
    const ms = (res.token_analysis as any).market_structure;
    const depth = ms ? 'Advanced Analysis' : 'Basic Analysis';

    ctx.fillStyle = 'rgba(0,255,200,0.5)';
    ctx.font = '9px monospace';
    ctx.fillText('TOKEN ANALYSIS  //  ' + depth, 20, 72);

    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`${res.token_analysis.token_symbol}  ${res.token_analysis.token_address.slice(0,8)}...`, 20, 92);

    // Top originators list
    ctx.fillStyle = 'rgba(0,255,200,0.5)';
    ctx.font = '9px monospace';
    ctx.fillText('TOP ORIGINATORS', 20, 120);
    res.top_originators.slice(0, 5).forEach((o, i) => {
      const scoreColor = o.originator_score >= 0.7 ? '#00ffff' : '#00ff80';
      ctx.fillStyle = scoreColor;
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`#${i+1} ${o.wallet.slice(0,6)}...${o.wallet.slice(-4)}`, 20, 140 + i * 22);
      ctx.fillStyle = 'rgba(0,255,200,0.5)';
      ctx.font = '9px monospace';
      ctx.fillText(`${(o.originator_score * 100).toFixed(0)}%`, 230, 140 + i * 22);
    });

    // Market structure panel
    if (ms) {
      ctx.fillStyle = 'rgba(0,100,80,0.15)';
      ctx.fillRect(290, 68, 390, 290);
      ctx.strokeStyle = 'rgba(0,255,200,0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(290, 68, 390, 290);

      ctx.fillStyle = '#00ffcc';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('MARKET STRUCTURE', 302, 86);
      ctx.strokeStyle = 'rgba(0,255,200,0.15)';
      ctx.beginPath(); ctx.moveTo(302, 90); ctx.lineTo(668, 90); ctx.stroke();

      const sx = 302, sw = 155;
      drawGauge(sx, 110, sw, ms.holder_concentration, '#ff6666', 'HOLDER CONCENTRATION');
      drawGauge(sx, 138, sw, ms.holder_growth_rate + 0.1, '#00ff80', 'HOLDER GROWTH');

      ctx.fillStyle = 'rgba(0,255,200,0.5)';
      ctx.font = '9px monospace';
      const labels = ['VOLUME VELOCITY', 'TX FREQUENCY'];
      const vals   = [ms.volume_velocity, ms.transaction_frequency];
      labels.forEach((l, i) => {
        ctx.fillStyle = 'rgba(0,255,200,0.5)';
        ctx.font = '9px monospace';
        ctx.fillText(l + ':', sx + i * 170, 175);
        ctx.fillStyle = '#00ffff';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(vals[i].toUpperCase(), sx + i * 170, 191);
      });
    }
  }

  // ── Quality seal ─────────────────────────────────────────────
  const sealX = W - 140, sealY = H - 46;
  ctx.fillStyle = 'rgba(0,255,200,0.08)';
  ctx.fillRect(sealX, sealY, 124, 32);
  ctx.strokeStyle = 'rgba(0,255,200,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(sealX, sealY, 124, 32);
  ctx.fillStyle = '#00ffcc';
  ctx.font = 'bold 9px monospace';
  ctx.fillText('✓ PATIENT ZERO CERTIFIED', sealX + 8, sealY + 14);
  ctx.fillStyle = 'rgba(0,255,200,0.5)';
  ctx.font = '8px monospace';
  ctx.fillText('@EssoVance — BIOLUMINESCENCE', sealX + 8, sealY + 25);

  const link = document.createElement('a');
  link.download = 'patient-zero-premium-card.png';
  link.href = shareCanvas.toDataURL('image/png');
  link.click();
});

//  Raycaster (Particle Click & Hover) 
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

document.addEventListener('mousemove', (e) => {
  // Graph Dragging
  if (appState.mode === 'analysis' && relationshipGraph.isVisible()) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    relationshipGraph.moveDrag(raycaster);
  }

  // Hover pointers
  if ((e.target as HTMLElement).closest('#hud-stats, #legend, #mode-toggle, #mode2-input, #summary-panel, #briefing-panel, #share-card-panel, #graph-legend')) {
    document.body.style.cursor = 'default';
    return;
  }

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  let intersects: any[] = [];
  if (appState.mode === 'ecosystem' && latestState) {
    intersects = raycaster.intersectObjects(particleSystem.getMeshes());
  } else if (appState.mode === 'analysis' && appState.analysisType === 'token') {
    intersects = raycaster.intersectObjects(mode2Scene.getMeshes());
  } else if (appState.mode === 'analysis' && relationshipGraph.isVisible()) {
    intersects = raycaster.intersectObjects(relationshipGraph.getMeshes());
  }

  // Bug 1 fix: show wallet address tooltip when hovering graph nodes
  if (appState.mode === 'analysis' && relationshipGraph.isVisible()) {
    const hover = relationshipGraph.getHoveredWallet(raycaster);
    if (hover) {
      relationshipGraph.showTooltip(hover.wallet, hover.interactionCount, hover.strength, e.clientX, e.clientY);
    } else {
      relationshipGraph.hideTooltip();
    }
  } else {
    relationshipGraph.hideTooltip();
  }

  document.body.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
});

document.addEventListener('mousedown', (e) => {
  if (appState.mode === 'analysis' && relationshipGraph.isVisible()) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(relationshipGraph.getMeshes());
    if (intersects.length > 0) {
      relationshipGraph.startDrag(intersects[0].object as THREE.Mesh, raycaster);
    }
  }
});

document.addEventListener('mouseup', () => {
  if (appState.mode === 'analysis' && relationshipGraph.isVisible()) {
    relationshipGraph.endDrag();
  }
});

document.addEventListener('click', async (e) => {
  if ((e.target as HTMLElement).closest('#mode2-input, #summary-panel, #briefing-panel, #mode-toggle, #share-card-panel, #graph-legend, #hud-stats, #legend')) {
    return;
  }

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  if (appState.mode === 'ecosystem' && latestState) {
    const intersects = raycaster.intersectObjects(particleSystem.getMeshes());
    if (intersects.length > 0) {
      const wallet = intersects[0].object.userData.wallet;
      if (wallet) showMode1Briefing(wallet, e.clientX, e.clientY);
    }
  } else if (appState.mode === 'analysis' && appState.analysisType === 'token') {
    const intersects = raycaster.intersectObjects(mode2Scene.getMeshes());
    if (intersects.length > 0) {
      const wallet = intersects[0].object.userData.wallet;
      if (wallet) await fetchAndShowBriefing(wallet, e.clientX, e.clientY);
    }
  } else if (appState.mode === 'analysis' && relationshipGraph.isVisible()) {
    // Bug 1 fix: clicking a graph node shows its full address in the briefing panel
    const hover = relationshipGraph.getHoveredWallet(raycaster);
    if (hover) showGraphNodeBriefing(hover.wallet, hover.interactionCount, hover.strength, e.clientX, e.clientY);
  }
});

briefingClose.addEventListener('click', () => {
  briefingPanel.classList.add('hidden');
});

// Graph Controls
const walletGraphControls = document.getElementById('wallet-graph-controls') as HTMLDivElement;

btnExploreGraph.addEventListener('click', async () => {
  const address = analysisInput.value.trim();
  if (!address || !appState.userApiKey) return;
  
  btnExploreGraph.textContent = 'Loading graph...';
  btnExploreGraph.disabled = true;

  try {
    const res = await fetch(`${API_URL}/wallet/relationships`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: address, user_api_key: appState.userApiKey })
    });
    const data = await res.json();
    if (res.ok) {
      relationshipGraph.loadGraph(data);
      summaryPanel.classList.add('hidden'); // Hide original summary to focus on graph
      btnExploreGraph.style.display = 'none';
      btnCloseGraph.style.display = 'block';
      graphLegend.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Failed to load relationships', err);
  } finally {
    btnExploreGraph.textContent = '🔗 Explore Relationships';
    btnExploreGraph.disabled = false;
  }
});

btnCloseGraph.addEventListener('click', () => {
  relationshipGraph.clear();
  btnExploreGraph.style.display = 'block';
  btnCloseGraph.style.display = 'none';
  graphLegend.classList.add('hidden');
  summaryPanel.classList.remove('hidden'); // Restore summary
});

function showGraphNodeBriefing(wallet: string, interactionCount: number, strength: number, x: number, y: number) {
  const classification = strength >= 0.8 ? 'STRONG PARTNER' : (strength >= 0.4 ? 'MODERATE PARTNER' : 'WEAK PARTNER');
  const strengthPct = (strength * 100).toFixed(0);
  const bars = '█'.repeat(Math.round(strength * 10)) + '░'.repeat(10 - Math.round(strength * 10));

  briefingContent.innerHTML = `
    <div style="font-size:11px;color:rgba(0,255,200,0.5);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">Graph Node</div>
    <div style="font-size:13px;color:#00ffff;margin-bottom:4px;font-weight:bold;word-break:break-all;">${wallet}</div>
    <div style="font-size:10px;color:rgba(0,255,200,0.6);margin-bottom:12px;">${wallet.slice(0, 8)}...${wallet.slice(-4)}</div>

    <div style="font-size:11px;margin-bottom:4px;display:flex;justify-content:space-between;">
      <span style="color:rgba(0,255,200,0.6)">Relationship:</span>
      <span style="color:#00ffcc;text-transform:uppercase;font-size:10px">${classification}</span>
    </div>
    <div style="font-size:11px;margin-bottom:4px;display:flex;justify-content:space-between;">
      <span style="color:rgba(0,255,200,0.6)">Co-appearances:</span>
      <span style="color:#00ffff">${interactionCount} tx</span>
    </div>
    <div style="font-size:11px;margin-bottom:8px;display:flex;justify-content:space-between;">
      <span style="color:rgba(0,255,200,0.6)">Strength:</span>
      <span style="color:#00ffff">${strengthPct}%</span>
    </div>
    <div style="font-family:monospace;font-size:10px;color:#00ff80;letter-spacing:1px;">${bars}</div>
  `;

  const panelW = 280;
  const panelH = 240;
  const left = Math.min(x + 20, window.innerWidth - panelW - 20);
  const top  = Math.min(y - 20, window.innerHeight - panelH - 20);

  briefingPanel.style.left = `${left}px`;
  briefingPanel.style.top  = `${top}px`;
  briefingPanel.classList.remove('hidden');
}

function showMode1Briefing(wallet: string, x: number, y: number) {
  if (!latestState) return;
  const node = latestState.nodes.find(n => n[0] === wallet)?.[1];
  if (!node) return;

  const classification = node.originatorScore >= 0.7 ? 'Genuine Originator' : (node.originatorScore >= 0.4 ? 'Mixed / Unknown' : 'Likely Follower');
  
  // Fake recent activity from timingPattern for ecosystem mode to avoid massive UI logic rewrite
  // Or fetch pairs from state.pairs
  let activityHtml = '';
  const pairsIn = latestState.pairs.filter(p => p[1].buyerSequence.some(b => b.wallet === wallet));
  
  if (pairsIn.length > 0) {
    activityHtml = pairsIn.slice(0, 5).map(p => {
      const pos = p[1].buyerSequence.findIndex(b => b.wallet === wallet) + 1;
      return `
        <div style="font-size:10px;display:flex;justify-content:space-between;border-bottom:1px dashed rgba(0,255,200,0.15);padding:4px 0;">
          <span style="color:#00ffff">${p[1].symbol || 'TOKEN'}</span>
          <span style="color:rgba(255,255,255,0.6)">Pos #${pos}</span>
        </div>
      `;
    }).join('');
  } else {
    activityHtml = '<div style="color:rgba(255,255,255,0.4)">No recent pairs found in active memory.</div>';
  }

  briefingContent.innerHTML = `
    <div style="font-size:14px;color:#00ffff;margin-bottom:8px;font-weight:bold;">${wallet.slice(0,6)}...${wallet.slice(-4)}</div>
    <div style="font-size:11px;color:#00ffcc;margin-bottom:12px;text-transform:uppercase;">${classification}</div>
    
    <div style="font-size:11px;margin-bottom:4px;display:flex;justify-content:space-between;">
      <span style="color:rgba(0,255,200,0.6)">Originator Score:</span>
      <span style="color:#00ffff">${(node.originatorScore * 100).toFixed(1)}%</span>
    </div>
    <div style="font-size:11px;margin-bottom:4px;display:flex;justify-content:space-between;">
      <span style="color:rgba(0,255,200,0.6)">Follower Score:</span>
      <span style="color:#00ffff">${(node.followerScore * 100).toFixed(1)}%</span>
    </div>
    <div style="font-size:11px;margin-bottom:12px;display:flex;justify-content:space-between;">
      <span style="color:rgba(0,255,200,0.6)">Early Purchases:</span>
      <span style="color:#00ffff">${node.timingPattern.earlyBuyerCount} / ${node.timingPattern.totalPairs} pairs</span>
    </div>
    
    <div style="font-size:10px;color:rgba(0,255,200,0.5);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.1em;">Recent Activity</div>
    ${activityHtml}
  `;

  const panelW = 280;
  const panelH = 300; 
  const left = Math.min(x + 20, window.innerWidth - panelW - 20);
  const top = Math.min(y - 20, window.innerHeight - panelH - 20);
  
  briefingPanel.style.left = `${left}px`;
  briefingPanel.style.top = `${top}px`;
  briefingPanel.classList.remove('hidden');
}

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
    relationshipGraph.update(delta);
  }

  biolumScene.render();
}

animate();
