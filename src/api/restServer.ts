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

export function startRestServer(): void {
  app.listen(CONFIG.REST_PORT, () => {
    logger.info(`REST API listening on http://localhost:${CONFIG.REST_PORT}`);
  });
}
