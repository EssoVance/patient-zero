import {
  GraphState,
  GraphStateSerialized,
  SwapEvent,
  WalletNode,
  PairNode,
  TemporalEdge,
} from '../types';
import { CONFIG, logger } from '../config';
import { walletTimingExtractor } from '../parser/walletTimingExtractor';

// ============================================================
// PATIENT ZERO — In-Memory Graph Store (24h rolling window)
// ============================================================

class GraphStore {
  private state: GraphState = {
    nodes: new Map<string, WalletNode>(),
    edges: [],
    pairs: new Map<string, PairNode>(),
    lastUpdated: Date.now(),
  };

  constructor() {
    // Prune stale data every 5 minutes
    setInterval(() => this.prune(), 5 * 60 * 1_000);
  }

  // ── Mutations ─────────────────────────────────────────────

  addSwapEvent(event: SwapEvent): void {
    // Upsert wallet node
    walletTimingExtractor.processSwapEvent(event, this.state.nodes);

    // Upsert pair node
    let pair = this.state.pairs.get(event.pairId);
    if (!pair) {
      pair = {
        pairId: event.pairId,
        launchTime: event.timestamp,
        mint: event.pairId,
        buyerSequence: [],
        originators: [],
        followers: [],
      };
      this.state.pairs.set(event.pairId, pair);
    }

    // Only add buys to the sequence; deduplicate per wallet
    if (event.side === 'buy') {
      const alreadyIn = pair.buyerSequence.some(
        (b) => b.wallet === event.wallet
      );
      if (!alreadyIn) {
        pair.buyerSequence.push({
          wallet: event.wallet,
          timestamp: event.timestamp,
          amount: event.amount,
        });
        pair.buyerSequence.sort((a, b) => a.timestamp - b.timestamp);
      }
    }

    this.state.lastUpdated = Date.now();
  }

  addEdges(edges: TemporalEdge[]): void {
    this.state.edges.push(...edges);
    this.state.lastUpdated = Date.now();
  }

  replaceEdges(edges: TemporalEdge[]): void {
    this.state.edges = edges;
    this.state.lastUpdated = Date.now();
  }

  updateWalletScore(
    address: string,
    originatorScore: number,
    followerScore: number
  ): void {
    const node = this.state.nodes.get(address);
    if (node) {
      node.originatorScore = originatorScore;
      node.followerScore = followerScore;
      node.lastUpdated = Date.now();
    }
  }

  setPairOriginatorsFollowers(
    pairId: string,
    originators: string[],
    followers: string[]
  ): void {
    const pair = this.state.pairs.get(pairId);
    if (pair) {
      pair.originators = originators;
      pair.followers = followers;
    }
  }

  // ── Queries ───────────────────────────────────────────────

  getState(): GraphState {
    return this.state;
  }

  getTopPairs(n: number): PairNode[] {
    return [...this.state.pairs.values()]
      .sort((a, b) => b.buyerSequence.length - a.buyerSequence.length)
      .slice(0, n);
  }

  getTopOriginators(n: number): WalletNode[] {
    return [...this.state.nodes.values()]
      .sort((a, b) => b.originatorScore - a.originatorScore)
      .slice(0, n);
  }

  // ── Maintenance ───────────────────────────────────────────

  prune(): void {
    const cutoff = Date.now() - CONFIG.DATA_RETENTION_MS;

    // Remove stale pairs
    for (const [id, pair] of this.state.pairs) {
      if (pair.launchTime < cutoff) {
        this.state.pairs.delete(id);
        logger.debug(`Pruned pair ${id}`);
      }
    }

    // Remove wallet nodes with no recent activity
    for (const [addr, node] of this.state.nodes) {
      if (node.lastUpdated < cutoff) {
        this.state.nodes.delete(addr);
      }
    }

    // Remove edges referencing deleted pairs/wallets
    const activePairs = new Set(this.state.pairs.keys());
    const activeWallets = new Set(this.state.nodes.keys());
    this.state.edges = this.state.edges.filter(
      (e) =>
        activePairs.has(e.pairId) &&
        activeWallets.has(e.fromWallet) &&
        activeWallets.has(e.toWallet)
    );

    logger.info(
      `Pruned store — ${this.state.nodes.size} nodes, ${this.state.edges.length} edges, ${this.state.pairs.size} pairs`
    );
  }

  // ── Serialisation ─────────────────────────────────────────

  serialize(): GraphStateSerialized {
    const topOriginators = this.getTopOriginators(10).map((n) => ({
      address: n.address,
      score: n.originatorScore,
    }));

    return {
      nodes: [...this.state.nodes.entries()],
      edges: this.state.edges,
      pairs: [...this.state.pairs.entries()],
      lastUpdated: this.state.lastUpdated,
      stats: {
        totalNodes: this.state.nodes.size,
        totalEdges: this.state.edges.length,
        totalPairs: this.state.pairs.size,
        topOriginators,
      },
    };
  }
}

export const graphStore = new GraphStore();
