import { TransactionParser } from '../src/parser/transactionParser';
import { WalletTimingExtractor } from '../src/parser/walletTimingExtractor';
import { SwapEvent, WalletNode, PairNode } from '../src/types';

// Mock the solanaConn module
jest.mock('../src/rpc/solanaConnection', () => ({
  solanaConn: {
    getTransaction: jest.fn(),
    subscribeToLogs: jest.fn(),
    unsubscribe: jest.fn(),
  },
}));

import { solanaConn } from '../src/rpc/solanaConnection';
const mockGetTransaction = solanaConn.getTransaction as jest.Mock;

// ============================================================
// Transaction Parser Tests
// ============================================================

describe('TransactionParser', () => {
  const parser = new TransactionParser();
  const PAIR_ID = 'mint_abc123';
  const LAUNCH_TIME = 1_700_000_000_000;
  const SIG = 'sig_xyz';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parseLogsForSwaps returns SwapEvent for buy logs', async () => {
    const mockTx = {
      blockTime: 1_700_001,
      transaction: {
        message: {
          getAccountKeys: () => ({
            staticAccountKeys: [{ toBase58: () => 'wallet_buyer_1' }],
          }),
        },
      },
      meta: {
        preBalances: [5_000_000_000],
        postBalances: [4_500_000_000],
        logMessages: ['Instruction: Buy', 'Program log: ray_log'],
      },
    };
    mockGetTransaction.mockResolvedValueOnce(mockTx);

    const event = await parser.parseLogsForSwaps(
      ['Instruction: Buy', 'Program log: success'],
      SIG,
      PAIR_ID,
      LAUNCH_TIME
    );

    expect(event).not.toBeNull();
    expect(event?.side).toBe('buy');
    expect(event?.wallet).toBe('wallet_buyer_1');
    expect(event?.amount).toBe(500_000_000);
    expect(event?.pairId).toBe(PAIR_ID);
  });

  test('parseLogsForSwaps returns null for non-swap logs', async () => {
    const event = await parser.parseLogsForSwaps(
      ['Program log: some other instruction'],
      SIG,
      PAIR_ID,
      LAUNCH_TIME
    );
    expect(event).toBeNull();
    expect(mockGetTransaction).not.toHaveBeenCalled();
  });

  test('parseSwap returns null when getTransaction returns null', async () => {
    mockGetTransaction.mockResolvedValueOnce(null);
    const event = await parser.parseSwap(SIG, PAIR_ID, LAUNCH_TIME);
    expect(event).toBeNull();
  });
});

// ============================================================
// WalletTimingExtractor Tests
// ============================================================

describe('WalletTimingExtractor', () => {
  const extractor = new WalletTimingExtractor();

  const makeSwap = (
    wallet: string,
    timestamp: number,
    pairId = 'pair_1',
    side: 'buy' | 'sell' = 'buy'
  ): SwapEvent => ({
    wallet,
    timestamp,
    amount: 1_000_000,
    pairId,
    side,
    signature: `sig_${wallet}_${timestamp}`,
  });

  test('extractBuyerSequence sorts by timestamp and deduplicates', () => {
    const events: SwapEvent[] = [
      makeSwap('wallet_c', 300),
      makeSwap('wallet_a', 100),
      makeSwap('wallet_b', 200),
      makeSwap('wallet_a', 150), // duplicate wallet — keep earliest (100)
    ];
    const seq = extractor.extractBuyerSequence(events);
    expect(seq).toHaveLength(3);
    expect(seq[0].wallet).toBe('wallet_a');
    expect(seq[0].timestamp).toBe(100);
    expect(seq[1].wallet).toBe('wallet_b');
    expect(seq[2].wallet).toBe('wallet_c');
  });

  test('computeTimingPattern computes correct averageTimeToEntry', () => {
    const walletNodes = new Map<string, WalletNode>();
    // Add two swaps for wallet_a across two pairs
    extractor.processSwapEvent(makeSwap('wallet_a', 1_000_100, 'pair_1'), walletNodes);
    extractor.processSwapEvent(makeSwap('wallet_a', 2_000_200, 'pair_2'), walletNodes);

    const pairs = new Map<string, PairNode>([
      ['pair_1', {
        pairId: 'pair_1', launchTime: 1_000_000, mint: 'pair_1',
        buyerSequence: [{ wallet: 'wallet_a', timestamp: 1_000_100, amount: 1_000_000 }],
        originators: [], followers: [],
      }],
      ['pair_2', {
        pairId: 'pair_2', launchTime: 2_000_000, mint: 'pair_2',
        buyerSequence: [{ wallet: 'wallet_a', timestamp: 2_000_200, amount: 1_000_000 }],
        originators: [], followers: [],
      }],
    ]);

    const node = walletNodes.get('wallet_a')!;
    const pattern = extractor.computeTimingPattern(node, pairs);

    // pair_1: 100ms, pair_2: 200ms → average = 150ms
    expect(pattern.averageTimeToEntry).toBe(150);
    expect(pattern.totalPairs).toBe(2);
  });
});
