import express, { Request, Response } from 'express';
import cors from 'cors';
import { graphStore } from '../storage/graphStore';
import { CONFIG, logger } from '../config';
import { liveAnalyzer } from '../rpc/liveAnalyzer';
import * as http from 'http';

// ============================================================
// PATIENT ZERO - REST API Server
// ============================================================

const app = express();
app.use(cors());
app.use(express.json());

//  Health 
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

//  Full graph state 
app.get('/api/graph', (_req: Request, res: Response) => {
  res.json(graphStore.serialize());
});

//  Top wallets sorted by originator score 
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

//  Single wallet 
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

//  Active pairs 
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

//  Stats summary 
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

// 
// MODE 2 - Specific Analysis Endpoints (User API Key Powered)
// 

//  POST /api/analyze/wallet 
app.post('/api/analyze/wallet', async (req: Request, res: Response) => {
  const { wallet_address, user_api_key } = req.body as { wallet_address?: string, user_api_key?: string };
  if (!wallet_address) {
    res.status(400).json({ error: 'wallet_address is required' });
    return;
  }
  if (!user_api_key) {
    res.status(400).json({ error: 'Helius API key required for analysis' });
    return;
  }

  try {
    const analysis = await liveAnalyzer.analyzeWalletLive(wallet_address, user_api_key);
    res.json(analysis);
  } catch (err: any) {
    logger.error('Live wallet analysis failed', err);
    res.status(500).json({ error: err.message || 'Failed to analyze wallet via live RPC' });
  }
});

//  POST /api/analyze/token 
app.post('/api/analyze/token', async (req: Request, res: Response) => {
  const { token_address, user_api_key } = req.body as { token_address?: string, user_api_key?: string };
  if (!token_address) {
    res.status(400).json({ error: 'token_address is required' });
    return;
  }
  if (!user_api_key) {
    res.status(400).json({ error: 'Helius API key required for analysis' });
    return;
  }

  try {
    const analysis = await liveAnalyzer.analyzeTokenLive(token_address, user_api_key);
    res.json(analysis);
  } catch (err: any) {
    logger.error('Live token analysis failed', err);
    res.status(500).json({ error: err.message || 'Failed to analyze token via live RPC' });
  }
});

//  GET /api/wallet/:address/briefing 
app.get('/api/wallet/:address/briefing', (req: Request, res: Response) => {
  const { address } = req.params;
  const state = graphStore.getState();
  const node = state.nodes.get(address);

  if (!node) {
    res.status(404).json({ error: 'Wallet not found in active graph' });
    return;
  }

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
        token: pair.pairId.slice(0, 8) + '.',
        symbol: pair.symbol ?? '???',
        position: idx + 1,
        timestamp: pair.buyerSequence[idx].timestamp,
      });
    }
  }
  recentActivity.sort((a, b) => b.timestamp - a.timestamp);

  const snippet = address.slice(0, 6) + '.' + address.slice(-4);

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

export function startRestServer(): http.Server {
  const server = http.createServer(app);
  // On Render, we must use the single PORT env var for both HTTP and WS
  const port = process.env.PORT || CONFIG.REST_PORT;
  server.listen(port, () => {
    logger.info(`REST API listening on port ${port}`);
  });
  return server;
}
