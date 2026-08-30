import { TemporalEdge, WalletNode } from '../types';
import { CONFIG, logger } from '../config';

// ============================================================
// PATIENT ZERO — Coincidence Corrector
// Marks edges A→B as 'coincidence' when the co-occurrence is
// statistically indistinguishable from random chance.
// ============================================================

export class CoincidenceCorrector {
  /**
   * For each A→B edge, estimate whether B following A is statistically
   * significant or likely coincidental.
   *
   * Method:
   *  1. Count how many times A→B appear together across all pairs (observed).
   *  2. Estimate expected co-occurrences under the null (independent random buyers).
   *  3. Compute a z-score; if z < 1.96 (p > 0.05), mark as coincidence.
   */
  correct(
    edges: TemporalEdge[],
    nodes: Map<string, WalletNode>
  ): TemporalEdge[] {
    // Build co-occurrence counts per wallet pair
    const coCount = new Map<string, number>();
    for (const edge of edges) {
      const key = `${edge.fromWallet}:${edge.toWallet}`;
      coCount.set(key, (coCount.get(key) ?? 0) + 1);
    }

    const totalPairs = new Set(edges.map((e) => e.pairId)).size;

    return edges.map((edge) => {
      const key = `${edge.fromWallet}:${edge.toWallet}`;
      const observed = coCount.get(key) ?? 1;

      const aNode = nodes.get(edge.fromWallet);
      const bNode = nodes.get(edge.toWallet);
      const aActivity = aNode ? aNode.entries.length : 1;
      const bActivity = bNode ? bNode.entries.length : 1;

      // Null hypothesis: B buys on any given pair with prob = bActivity / totalPairs
      const pNull = Math.min(bActivity / Math.max(totalPairs, 1), 1);
      const expected = pNull * aActivity;

      // Z-score approximation for binomial
      const variance = aActivity * pNull * (1 - pNull);
      const stdDev = Math.sqrt(Math.max(variance, 0.0001));
      const z = (observed - expected) / stdDev;

      // Two-tailed p-value approximation: p ≈ 2 * Φ(-|z|)
      const pValue = 2 * this.standardNormalCDF(-Math.abs(z));

      const correctedEdge: TemporalEdge = {
        ...edge,
        pValue,
        edgeType:
          pValue <= CONFIG.PVALUE_THRESHOLD ? 'origin' : 'coincidence',
      };

      return correctedEdge;
    });
  }

  /**
   * Approximation of the standard normal CDF using Abramowitz & Stegun.
   */
  private standardNormalCDF(x: number): number {
    const t = 1 / (1 + 0.2315419 * Math.abs(x));
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const p =
      d *
      t *
      (0.3193815 +
        t * (-0.3565638 + t * (1.7814779 + t * (-1.8212559 + t * 1.3302744))));
    return x > 0 ? 1 - p : p;
  }
}

export const coincidenceCorrector = new CoincidenceCorrector();
