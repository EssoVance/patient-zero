import { WalletNode, TemporalEdge } from '../types';
import { logger } from '../config';

// ============================================================
// PATIENT ZERO — PageRank Centrality
// Identifies wallets with high ecosystem-wide influence.
// ============================================================

export class PageRankCentrality {
  /**
   * Compute PageRank scores for all wallet nodes.
   * Only uses edges where edgeType !== 'coincidence'.
   */
  compute(
    nodes: Map<string, WalletNode>,
    edges: TemporalEdge[],
    dampingFactor = 0.85,
    iterations = 50
  ): Map<string, number> {
    const N = nodes.size;
    if (N === 0) return new Map();

    const validEdges = edges.filter((e) => e.edgeType !== 'coincidence');
    const nodeAddresses = [...nodes.keys()];

    // Initialise ranks uniformly
    const ranks = new Map<string, number>();
    for (const addr of nodeAddresses) {
      ranks.set(addr, 1 / N);
    }

    // Precompute out-degree per node
    const outDegree = new Map<string, number>();
    for (const edge of validEdges) {
      outDegree.set(
        edge.fromWallet,
        (outDegree.get(edge.fromWallet) ?? 0) + 1
      );
    }

    // Precompute incoming edges per node
    const inEdges = new Map<string, TemporalEdge[]>();
    for (const addr of nodeAddresses) {
      inEdges.set(addr, []);
    }
    for (const edge of validEdges) {
      const list = inEdges.get(edge.toWallet);
      if (list) list.push(edge);
    }

    // Iterate
    for (let iter = 0; iter < iterations; iter++) {
      const newRanks = new Map<string, number>();

      for (const addr of nodeAddresses) {
        const incoming = inEdges.get(addr) ?? [];
        let sum = 0;
        for (const edge of incoming) {
          const fromRank = ranks.get(edge.fromWallet) ?? 0;
          const deg = outDegree.get(edge.fromWallet) ?? 1;
          sum += fromRank / deg;
        }
        newRanks.set(addr, (1 - dampingFactor) / N + dampingFactor * sum);
      }

      for (const [addr, rank] of newRanks) {
        ranks.set(addr, rank);
      }
    }

    logger.debug(`PageRank computed for ${N} nodes over ${iterations} iterations`);
    return ranks;
  }

  /**
   * Blend PageRank into existing originator scores (70/30 split).
   * Mutates nodes in-place.
   */
  enhanceScoresWithPageRank(
    nodes: Map<string, WalletNode>,
    pageRanks: Map<string, number>
  ): void {
    if (pageRanks.size === 0) return;

    const maxRank = Math.max(...pageRanks.values(), 0.000001);

    for (const [addr, node] of nodes) {
      const rawRank = pageRanks.get(addr) ?? 0;
      const normalizedRank = rawRank / maxRank; // 0-1
      const blended = 0.7 * node.originatorScore + 0.3 * normalizedRank;
      node.originatorScore = Math.max(0, Math.min(1, blended));
      node.followerScore = 1 - node.originatorScore;
    }

    logger.info('PageRank blended into originator scores');
  }
}

export const pageRankCentrality = new PageRankCentrality();
