import express, { Request, Response } from 'express';
import cors from 'cors';
import { graphStore } from '../storage/graphStore';
import { CONFIG, logger } from '../config';

// ============================================================
// PATIENT ZERO — REST API Server
// ============================================================

const app = express();
app.use(cors());
app.use(express.json());

// ── Health ────────────────────────────────────────────────
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// ── Full graph state ──────────────────────────────────────
app.get('/api/graph', (_req: Request, res: Response) => {
  res.json(graphStore.serialize());
});

// ── Top wallets sorted by originator score ────────────────
app.get('/api/wallets', (_req: Request, res: Response) => {
  const top = graphStore.getTopOriginators(50).map((n) => ({
    address: n.address,
    originatorScore: n.originatorScore,
    followerScore: n.followerScore,
    totalPairs: n.timingPattern.totalPairs,
    earlyBuyerCount: n.timingPattern.earlyBuyerCount,
    avgTimeToEntry: n.timingPattern.averageTimeToEntry,
  }));
  res.json(top);
});

// ── Single wallet ─────────────────────────────────────────
app.get('/api/wallets/:address', (req: Request, res: Response) => {
  const { address } = req.params;
  const state = graphStore.getState();
  const node = state.nodes.get(address);
  if (!node) {
    res.status(404).json({ error: 'Wallet not found' });
    return;
  }
  res.json(node);
});

// ── Active pairs ──────────────────────────────────────────
app.get('/api/pairs', (_req: Request, res: Response) => {
  const state = graphStore.getState();
  const pairs = [...state.pairs.values()].map((p) => ({
    pairId: p.pairId,
    mint: p.mint,
    name: p.name,
    symbol: p.symbol,
    launchTime: p.launchTime,
    totalBuyers: p.buyerSequence.length,
    originators: p.originators.slice(0, 3),
    followers: p.followers.slice(0, 3),
  }));
  res.json(pairs);
});

// ── Stats summary ─────────────────────────────────────────
app.get('/api/stats', (_req: Request, res: Response) => {
  const state = graphStore.getState();
  const ser = graphStore.serialize();
  res.json({
    totalNodes: state.nodes.size,
    totalEdges: state.edges.length,
    totalPairs: state.pairs.size,
    topOriginators: ser.stats.topOriginators,
    lastUpdated: state.lastUpdated,
  });
});

// ═══════════════════════════════════════════════════════════
// MODE 2 — Specific Analysis Endpoints
// ═══════════════════════════════════════════════════════════

// ── POST /api/analyze/wallet ───────────────────────────────
// Returns leadership summary for a specific wallet address
app.post('/api/analyze/wallet', (req: Request, res: Response) => {
  const { wallet_address } = req.body as { wallet_address?: string };
  if (!wallet_address) {
    res.status(400).json({ error: 'wallet_address is required' });
    return;
  }

  const state = graphStore.getState();
  const node = state.nodes.get(wallet_address);

  if (!node) {
    res.status(404).json({ error: 'Wallet not currently tracked. It may not have appeared in any monitored pair since the backend started.' });
    return;
  }

  // Count how many pairs this wallet was an originator for
  const coinsLed = [...state.pairs.values()].filter(
    (p) => p.originators.includes(wallet_address)
  ).length;

  // Count top-5 appearances (wallet was in first 5 buyers)
  let top5appearances = 0;
  const discoveryHistory: Array<{
    token_address: string;
    token_name: string;
    token_symbol: string;
    position: number;
    originator_score: number;
    timestamp: number;
  }> = [];

  for (const pair of state.pairs.values()) {
    const idx = pair.buyerSequence.findIndex((b) => b.wallet === wallet_address);
    if (idx !== -1) {
      const position = idx + 1; // 1-indexed
      if (position <= 5) top5appearances++;
      discoveryHistory.push({
        token_address: pair.pairId,
        token_name: pair.name ?? pair.pairId.slice(0, 8),
        token_symbol: pair.symbol ?? '???',
        position,
        originator_score: node.originatorScore,
        timestamp: pair.buyerSequence[idx].timestamp,
      });
    }
  }

  // Sort history newest-first
  discoveryHistory.sort((a, b) => b.timestamp - a.timestamp);

  // Calculate follower ratio from edges
  const allEdges = state.edges;
  const edgesAsFollower = allEdges.filter(
    (e) => e.toWallet === wallet_address && e.edgeType !== 'coincidence'
  ).length;
  const edgesTotal = allEdges.filter(
    (e) => (e.fromWallet === wallet_address || e.toWallet === wallet_address) && e.edgeType !== 'coincidence'
  ).length;
  const followerRatio = edgesTotal > 0 ? edgesAsFollower / edgesTotal : 0;

  res.json({
    wallet: wallet_address,
    leadership_stats: {
      coins_led: coinsLed,
      top_5_appearances: top5appearances,
      avg_originator_score: Math.round(node.originatorScore * 1000) / 1000,
      network_centrality: Math.round((node.timingPattern.earlyBuyerCount / Math.max(node.timingPattern.totalPairs, 1)) * 1000) / 1000,
      follower_ratio: Math.round(followerRatio * 1000) / 1000,
      total_pairs_traded: node.timingPattern.totalPairs,
      avg_time_to_entry_ms: Math.round(node.timingPattern.averageTimeToEntry),
    },
    discovery_history: discoveryHistory.slice(0, 20),
    classification: node.originatorScore >= 0.7
      ? 'genuine_originator'
      : node.originatorScore >= 0.4
        ? 'mixed'
        : 'likely_follower',
  });
});

// ── POST /api/analyze/token ────────────────────────────────
// Returns top leading + follower wallets for a specific token
app.post('/api/analyze/token', (req: Request, res: Response) => {
  const { token_address } = req.body as { token_address?: string };
  if (!token_address) {
    res.status(400).json({ error: 'token_address is required' });
    return;
  }

  const state = graphStore.getState();
  const pair = state.pairs.get(token_address);

  if (!pair) {
    res.status(404).json({ error: 'Token not currently tracked. Only tokens detected since the backend started are available.' });
    return;
  }

  // Score each buyer using their wallet node data
  const scoredBuyers = pair.buyerSequence.map((buyer, idx) => {
    const walletNode = state.nodes.get(buyer.wallet);
    return {
      position: idx + 1,
      wallet: buyer.wallet,
      originator_score: walletNode?.originatorScore ?? 0,
      follower_score: walletNode?.followerScore ?? 1,
      time_from_launch_ms: buyer.timestamp - pair.launchTime,
      amount_lamports: buyer.amount,
      classification: (walletNode?.originatorScore ?? 0) >= 0.7
        ? 'genuine_originator'
        : (walletNode?.originatorScore ?? 0) >= 0.4
          ? 'mixed'
          : 'likely_follower',
    };
  });

  // Sort by originator score descending
  const sortedByScore = [...scoredBuyers].sort(
    (a, b) => b.originator_score - a.originator_score
  );

  const leadingWallets = sortedByScore.slice(0, 10);
  const followerWallets = sortedByScore.slice(10, 20);

  res.json({
    token_analysis: {
      token_address: pair.pairId,
      token_name: pair.name ?? 'Unknown',
      token_symbol: pair.symbol ?? '???',
      launch_time: pair.launchTime,
      total_buyers: pair.buyerSequence.length,
    },
    leading_wallets: leadingWallets,
    follower_wallets: followerWallets,
  });
});

// ── GET /api/wallet/:address/briefing ─────────────────────
// Lightweight wallet briefing for particle click interaction
app.get('/api/wallet/:address/briefing', (req: Request, res: Response) => {
  const { address } = req.params;
  const state = graphStore.getState();
  const node = state.nodes.get(address);

  if (!node) {
    res.status(404).json({ error: 'Wallet not found in active graph' });
    return;
  }

  // Get last 5 pair interactions
  const recentActivity: Array<{
    token: string;
    symbol: string;
    position: number;
    timestamp: number;
  }> = [];

  for (const pair of state.pairs.values()) {
    const idx = pair.buyerSequence.findIndex((b) => b.wallet === address);
    if (idx !== -1) {
      recentActivity.push({
        token: pair.pairId.slice(0, 8) + '…',
        symbol: pair.symbol ?? '???',
        position: idx + 1,
        timestamp: pair.buyerSequence[idx].timestamp,
      });
    }
  }
  recentActivity.sort((a, b) => b.timestamp - a.timestamp);

  const snippet = address.slice(0, 6) + '…' + address.slice(-4);

  res.json({
    wallet: address,
    wallet_snippet: snippet,
    classification: node.originatorScore >= 0.7
      ? 'Genuine Originator'
      : node.originatorScore >= 0.4
        ? 'Mixed / Unknown'
        : 'Likely Follower',
    originator_score: node.originatorScore,
    follower_score: node.followerScore,
    total_pairs: node.timingPattern.totalPairs,
    early_buyer_count: node.timingPattern.earlyBuyerCount,
    recent_activity: recentActivity.slice(0, 5),
  });
});

export function startRestServer(): void {
  app.listen(CONFIG.REST_PORT, () => {
    logger.info(`REST API listening on http://localhost:${CONFIG.REST_PORT}`);
  });
}
