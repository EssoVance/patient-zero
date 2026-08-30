import { TemporalEdgeBuilder } from '../src/graph/temporalEdgeBuilder';
import { PageRankCentrality } from '../src/graph/pageRankCentrality';
import { PairNode, WalletNode } from '../src/types';

// ============================================================
// Graph Algorithm Tests
// ============================================================

const makeNode = (address: string, score = 0.5): WalletNode => ({
  address,
  entries: [],
  exits: [],
  timingPattern: { averageTimeToEntry: 0, earlyBuyerCount: 0, totalPairs: 0 },
  originatorScore: score,
  followerScore: 1 - score,
  lastUpdated: Date.now(),
});

const makePair = (
  buyers: Array<{ wallet: string; timestamp: number }>
): PairNode => ({
  pairId: 'test_pair',
  launchTime: 0,
  mint: 'test_pair',
  buyerSequence: buyers.map((b) => ({ ...b, amount: 1_000_000 })),
  originators: [],
  followers: [],
});

const WINDOW = 5 * 60 * 1_000; // 5 min

describe('TemporalEdgeBuilder', () => {
  const builder = new TemporalEdgeBuilder();

  test('creates edge A→B when B follows A within time window', () => {
    const pair = makePair([
      { wallet: 'A', timestamp: 0 },
      { wallet: 'B', timestamp: 30_000 }, // 30s after A
    ]);
    const edges = builder.buildEdgesForPair(pair);
    expect(edges).toHaveLength(1);
    expect(edges[0].fromWallet).toBe('A');
    expect(edges[0].toWallet).toBe('B');
    expect(edges[0].timeDelta).toBe(30_000);
  });

  test('does NOT create edge when timeDelta exceeds TIME_WINDOW_MS', () => {
    const pair = makePair([
      { wallet: 'A', timestamp: 0 },
      { wallet: 'B', timestamp: WINDOW + 1_000 }, // outside window
    ]);
    const edges = builder.buildEdgesForPair(pair);
    expect(edges).toHaveLength(0);
  });

  test('does NOT create self-edges (A→A)', () => {
    const pair = makePair([
      { wallet: 'A', timestamp: 0 },
      { wallet: 'A', timestamp: 1_000 },
    ]);
    const edges = builder.buildEdgesForPair(pair);
    expect(edges).toHaveLength(0);
  });

  test('edge weight is higher when timeDelta is smaller', () => {
    const pair = makePair([
      { wallet: 'A', timestamp: 0 },
      { wallet: 'B', timestamp: 1_000 },   // 1s → high weight
      { wallet: 'C', timestamp: 60_000 },  // 60s → lower weight
    ]);
    const edges = builder.buildEdgesForPair(pair);
    const edgeAB = edges.find(
      (e) => e.fromWallet === 'A' && e.toWallet === 'B'
    )!;
    const edgeAC = edges.find(
      (e) => e.fromWallet === 'A' && e.toWallet === 'C'
    )!;
    expect(edgeAB).toBeDefined();
    expect(edgeAC).toBeDefined();
    expect(edgeAB.weight).toBeGreaterThan(edgeAC.weight);
  });
});

describe('PageRankCentrality', () => {
  const pr = new PageRankCentrality();

  test('nodes with more incoming edges get higher PageRank', () => {
    const nodes = new Map<string, WalletNode>([
      ['A', makeNode('A')],
      ['B', makeNode('B')],
      ['C', makeNode('C')],
      ['D', makeNode('D')], // D has many incoming edges → should rank higher
    ]);

    // Many wallets point to D
    const edges = [
      { fromWallet: 'A', toWallet: 'D', pairId: 'p1', timeDelta: 1000, edgeType: 'origin' as const, weight: 1 },
      { fromWallet: 'B', toWallet: 'D', pairId: 'p1', timeDelta: 2000, edgeType: 'origin' as const, weight: 0.8 },
      { fromWallet: 'C', toWallet: 'D', pairId: 'p1', timeDelta: 3000, edgeType: 'origin' as const, weight: 0.6 },
      { fromWallet: 'A', toWallet: 'B', pairId: 'p1', timeDelta: 500,  edgeType: 'origin' as const, weight: 0.9 },
    ];

    const ranks = pr.compute(nodes, edges, 0.85, 100);

    const rankD = ranks.get('D') ?? 0;
    const rankC = ranks.get('C') ?? 0;
    // D has 3 incoming edges, C has 0 — D should rank higher
    expect(rankD).toBeGreaterThan(rankC);
  });
});
