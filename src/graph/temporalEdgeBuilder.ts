import { PairNode, TemporalEdge } from '../types';
import { CONFIG, logger } from '../config';

// ============================================================
// PATIENT ZERO — Temporal Edge Builder
// A→B edge exists if B buys within TIME_WINDOW_MS after A on the same pair.
// ============================================================

export class TemporalEdgeBuilder {
  /**
   * Build all temporal edges for a single pair's buyer sequence.
   */
  buildEdgesForPair(pair: PairNode): TemporalEdge[] {
    const seq = [...pair.buyerSequence].sort((a, b) => a.timestamp - b.timestamp);
    const edges: TemporalEdge[] = [];

    for (let i = 0; i < seq.length; i++) {
      for (let j = i + 1; j < seq.length; j++) {
        const a = seq[i];
        const b = seq[j];

        if (a.wallet === b.wallet) continue; // no self-edges

        const timeDelta = b.timestamp - a.timestamp;
        if (timeDelta > CONFIG.TIME_WINDOW_MS) break; // sequence is sorted; no further B can be within window

        const weight = 1 / (timeDelta / 1_000 + 1);

        edges.push({
          fromWallet: a.wallet,
          toWallet: b.wallet,
          pairId: pair.pairId,
          timeDelta,
          edgeType: 'origin',
          weight,
        });
      }
    }

    return edges;
  }

  /**
   * Build edges across all pairs, combining strength for repeated A→B pairs.
   */
  buildEdgesForAllPairs(pairs: Map<string, PairNode>): TemporalEdge[] {
    // key: `${fromWallet}:${toWallet}` → strongest edge so far
    const edgeMap = new Map<string, TemporalEdge>();

    for (const pair of pairs.values()) {
      const pairEdges = this.buildEdgesForPair(pair);
      for (const edge of pairEdges) {
        const key = `${edge.fromWallet}:${edge.toWallet}`;
        const existing = edgeMap.get(key);
        if (!existing || edge.weight > existing.weight) {
          edgeMap.set(key, edge);
        }
      }
    }

    const result = [...edgeMap.values()];
    logger.info(`Built ${result.length} temporal edges across ${pairs.size} pairs`);
    return result;
  }
}

export const temporalEdgeBuilder = new TemporalEdgeBuilder();
