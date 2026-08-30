import { WalletNode, PairNode, TemporalEdge } from '../types';
import { CONFIG, logger } from '../config';

// ============================================================
// PATIENT ZERO — Originator Scorer (Empirical Bayes Shrinkage)
// ============================================================

export class OriginatorScorer {
  /**
   * Score all wallets in-place using Bayesian shrinkage.
   * Mutates node.originatorScore and node.followerScore.
   */
  scoreAll(
    nodes: Map<string, WalletNode>,
    pairs: Map<string, PairNode>,
    edges: TemporalEdge[]
  ): void {
    if (nodes.size === 0) return;

    const nonCoincidenceEdges = edges.filter(
      (e) => e.edgeType !== 'coincidence'
    );

    // Pre-compute out-degree per wallet (how many others follow them)
    const outDegree = new Map<string, number>();
    for (const edge of nonCoincidenceEdges) {
      outDegree.set(
        edge.fromWallet,
        (outDegree.get(edge.fromWallet) ?? 0) + 1
      );
    }

    const maxOutDegree = Math.max(...outDegree.values(), 1);

    // Compute raw features per wallet
    const rawScores: number[] = [];
    const walletList = [...nodes.values()];

    for (const node of walletList) {
      rawScores.push(this.rawScore(node, pairs, outDegree, maxOutDegree));
    }

    // Population mean (used for shrinkage toward)
    const popMean =
      rawScores.reduce((s, v) => s + v, 0) / (rawScores.length || 1);

    // Apply shrinkage and write scores back
    for (let i = 0; i < walletList.length; i++) {
      const node = walletList[i];
      const n = node.entries.length;
      const k = CONFIG.MIN_OBSERVATIONS;
      const shrinkage = n / (n + k); // 0 → full shrink, 1 → trust observed

      const finalScore = shrinkage * rawScores[i] + (1 - shrinkage) * popMean;
      node.originatorScore = Math.max(0, Math.min(1, finalScore));
      node.followerScore = 1 - node.originatorScore;
    }

    logger.info(
      `Scored ${nodes.size} wallets (pop mean: ${popMean.toFixed(3)})`
    );

    // Classify wallets into pair originator/follower lists
    this.classifyWallets(nodes, pairs);
  }

  /**
   * Compute a raw (un-shrunk) originator score for a single wallet.
   */
  private rawScore(
    node: WalletNode,
    pairs: Map<string, PairNode>,
    outDegree: Map<string, number>,
    maxOutDegree: number
  ): number {
    const n = node.entries.length;
    if (n === 0) return 0.5;

    // Feature 1: early buyer rate (0-1)
    const earlyBuyerRate =
      node.timingPattern.earlyBuyerCount /
      Math.max(node.timingPattern.totalPairs, 1);

    // Feature 2: average rank in buyer sequences, normalised (lower rank = better)
    let totalRank = 0;
    let rankCount = 0;
    for (const entry of node.entries) {
      const pair = pairs.get(entry.pairId);
      if (!pair) continue;
      const pos = pair.buyerSequence.findIndex(
        (b) => b.wallet === node.address
      );
      if (pos !== -1) {
        const maxRank = pair.buyerSequence.length;
        totalRank += 1 - pos / Math.max(maxRank, 1); // 1 = first, 0 = last
        rankCount++;
      }
    }
    const avgRankScore = rankCount > 0 ? totalRank / rankCount : 0.5;

    // Feature 3: normalised out-degree (how many wallets follow this one)
    const normalizedOutDegree =
      (outDegree.get(node.address) ?? 0) / maxOutDegree;

    // Feature 4: time consistency — lower coefficient of variation of time-to-entry = more consistent
    const timesToEntry = node.entries
      .map((e) => {
        const pair = pairs.get(e.pairId);
        return pair ? e.timestamp - pair.launchTime : null;
      })
      .filter((t): t is number => t !== null && t >= 0);

    let timeConsistency = 0.5;
    if (timesToEntry.length > 1) {
      const mean = timesToEntry.reduce((s, v) => s + v, 0) / timesToEntry.length;
      const variance =
        timesToEntry.reduce((s, v) => s + (v - mean) ** 2, 0) /
        timesToEntry.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
      timeConsistency = Math.max(0, 1 - Math.min(cv, 1)); // 1 = very consistent, 0 = erratic
    }

    // Weighted combination
    const raw =
      0.4 * earlyBuyerRate +
      0.3 * avgRankScore +
      0.2 * normalizedOutDegree +
      0.1 * timeConsistency;

    return Math.max(0, Math.min(1, raw));
  }

  /**
   * Update each pair's originators/followers arrays based on final scores.
   */
  classifyWallets(
    nodes: Map<string, WalletNode>,
    pairs: Map<string, PairNode>
  ): void {
    for (const pair of pairs.values()) {
      pair.originators = [];
      pair.followers = [];

      for (const buyer of pair.buyerSequence) {
        const node = nodes.get(buyer.wallet);
        if (!node) continue;
        if (node.originatorScore >= CONFIG.ORIGINATOR_THRESHOLD) {
          pair.originators.push(buyer.wallet);
        } else if (node.originatorScore < CONFIG.MIXED_THRESHOLD) {
          pair.followers.push(buyer.wallet);
        }
      }
    }
  }
}

export const originatorScorer = new OriginatorScorer();
