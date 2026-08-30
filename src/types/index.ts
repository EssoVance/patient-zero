// ============================================================
// PATIENT ZERO — Shared Type Definitions
// ============================================================

export interface TimingPattern {
  /** Average milliseconds after pair launch this wallet first buys */
  averageTimeToEntry: number;
  /** Number of pairs where this wallet was in the first 5 buyers */
  earlyBuyerCount: number;
  /** Total pairs where this wallet participated */
  totalPairs: number;
}

export interface SwapEvent {
  wallet: string;
  timestamp: number;   // unix ms
  amount: number;      // SOL amount in lamports
  pairId: string;
  side: 'buy' | 'sell';
  signature: string;
}

export interface WalletNode {
  address: string;
  entries: Array<{ timestamp: number; pairId: string; amount: number }>;
  exits: Array<{ timestamp: number; pairId: string; amount: number }>;
  timingPattern: TimingPattern;
  originatorScore: number;  // 0–1
  followerScore: number;    // 0–1
  lastUpdated: number;
}

export interface PairNode {
  pairId: string;
  launchTime: number;
  mint: string;
  name?: string;
  symbol?: string;
  buyerSequence: Array<{ wallet: string; timestamp: number; amount: number }>;
  originators: string[];
  followers: string[];
}

export interface TemporalEdge {
  fromWallet: string;
  toWallet: string;
  pairId: string;
  timeDelta: number;   // ms between A and B first entry
  edgeType: 'origin' | 'follower' | 'coincidence';
  pValue?: number;
  weight: number;      // 1 / (timeDelta_seconds + 1) — closer = stronger
}

export interface GraphState {
  nodes: Map<string, WalletNode>;
  edges: TemporalEdge[];
  pairs: Map<string, PairNode>;
  lastUpdated: number;
}

export interface GraphStateSerialized {
  nodes: Array<[string, WalletNode]>;
  edges: TemporalEdge[];
  pairs: Array<[string, PairNode]>;
  lastUpdated: number;
  stats: {
    totalNodes: number;
    totalEdges: number;
    totalPairs: number;
    topOriginators: Array<{ address: string; score: number }>;
  };
}

export interface PumpFunToken {
  mint: string;
  name: string;
  symbol: string;
  createdTimestamp: number;
  bondingCurve: string;
}
