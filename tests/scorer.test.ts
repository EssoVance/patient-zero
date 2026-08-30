import { OriginatorScorer } from '../src/graph/originatorScorer';
import { WalletNode, PairNode, TemporalEdge } from '../src/types';

// ============================================================
// Originator Scorer (Bayesian) Tests
// ============================================================

const makeNode = (
  address: string,
  entries: Array<{ pairId: string; timestamp: number }>
): WalletNode => ({
  address,
  entries: entries.map((e) => ({ ...e, amount: 1_000_000 })),
  exits: [],
  timingPattern: {
    averageTimeToEntry: 0,
    earlyBuyerCount: 0,
    totalPairs: entries.length,
  },
  originatorScore: 0.5,
  followerScore: 0.5,
  lastUpdated: Date.now(),
});

/**
 * Build a realistic map of 10 pairs where `earlyWallet` is always in first 3 buyers
 * and `lateWallet` always buys after 4 minutes.
 */
function buildTestState() {
  const scorer = new OriginatorScorer();
  const pairs = new Map<string, PairNode>();
  const earlyEntries: Array<{ pairId: string; timestamp: number }> = [];
  const lateEntries:  Array<{ pairId: string; timestamp: number }> = [];

  for (let i = 0; i < 10; i++) {
    const pairId    = `pair_${i}`;
    const launchTime = i * 1_000_000;

    earlyEntries.push({ pairId, timestamp: launchTime + 5_000 });  // 5s after launch
    lateEntries.push({  pairId, timestamp: launchTime + 270_000 }); // 4.5min after launch

    pairs.set(pairId, {
      pairId,
      launchTime,
      mint: pairId,
      buyerSequence: [
        { wallet: 'filler_1', timestamp: launchTime + 1_000, amount: 1_000_000 },
        { wallet: 'filler_2', timestamp: launchTime + 2_000, amount: 1_000_000 },
        { wallet: 'early_wallet', timestamp: launchTime + 5_000, amount: 1_000_000 },
        { wallet: 'filler_3', timestamp: launchTime + 10_000, amount: 1_000_000 },
        { wallet: 'filler_4', timestamp: launchTime + 20_000, amount: 1_000_000 },
        { wallet: 'late_wallet', timestamp: launchTime + 270_000, amount: 1_000_000 },
      ],
      originators: [],
      followers: [],
    });
  }

  const earlyNode = makeNode('early_wallet', earlyEntries);
  earlyNode.timingPattern.earlyBuyerCount = 10; // always in top 5
  earlyNode.timingPattern.totalPairs      = 10;

  const lateNode  = makeNode('late_wallet', lateEntries);
  lateNode.timingPattern.earlyBuyerCount  = 0;
  lateNode.timingPattern.totalPairs       = 10;

  const nodes = new Map<string, WalletNode>([
    ['early_wallet', earlyNode],
    ['late_wallet',  lateNode],
  ]);

  const edges: TemporalEdge[] = [];

  return { scorer, nodes, pairs, edges };
}

describe('OriginatorScorer', () => {
  test('consistent early buyer scores > 0.7 (genuine originator)', () => {
    const { scorer, nodes, pairs, edges } = buildTestState();
    scorer.scoreAll(nodes, pairs, edges);
    const score = nodes.get('early_wallet')!.originatorScore;
    expect(score).toBeGreaterThan(0.7);
  });

  test('consistent late buyer scores < 0.4 (likely follower)', () => {
    const { scorer, nodes, pairs, edges } = buildTestState();
    scorer.scoreAll(nodes, pairs, edges);
    const score = nodes.get('late_wallet')!.originatorScore;
    expect(score).toBeLessThan(0.4);
  });

  test('wallet with only 1 observation is shrunk toward population mean', () => {
    const { scorer, pairs } = buildTestState();

    // One-shot wallet
    const oneShotNode = makeNode('one_shot', [
      { pairId: 'pair_0', timestamp: 1_000 }, // very early on one pair
    ]);
    oneShotNode.timingPattern.earlyBuyerCount = 1;
    oneShotNode.timingPattern.totalPairs      = 1;

    const nodes = new Map<string, WalletNode>([['one_shot', oneShotNode]]);
    scorer.scoreAll(nodes, pairs, []);

    const finalScore = oneShotNode.originatorScore;
    // Should not be extreme due to shrinkage; expect near mid-range
    expect(finalScore).toBeGreaterThan(0.1);
    expect(finalScore).toBeLessThan(0.95);
  });

  test('originatorScore + followerScore ≈ 1 for all wallets', () => {
    const { scorer, nodes, pairs, edges } = buildTestState();
    scorer.scoreAll(nodes, pairs, edges);
    for (const node of nodes.values()) {
      expect(node.originatorScore + node.followerScore).toBeCloseTo(1, 5);
    }
  });

  test('classifyWallets populates pair originators and followers correctly', () => {
    const { scorer, nodes, pairs, edges } = buildTestState();
    scorer.scoreAll(nodes, pairs, edges);

    // Check pair_0
    const pair0 = pairs.get('pair_0')!;
    expect(pair0.originators).toContain('early_wallet');
    expect(pair0.followers).toContain('late_wallet');
  });
});
