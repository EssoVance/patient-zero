// ============================================================
// PATIENT ZERO — App State (Dual-Mode Manager)
// ============================================================

export type AppMode = 'ecosystem' | 'analysis';
export type AnalysisType = 'wallet' | 'token' | null;

export interface WalletLeadershipStats {
  coins_led: number;
  top_5_appearances: number;
  avg_originator_score: number;
  network_centrality: number;
  follower_ratio: number;
  total_pairs_traded: number;
  avg_time_to_entry_ms: number;
}

export interface DiscoveryHistoryEntry {
  token_address: string;
  token_name: string;
  token_symbol: string;
  position: number;
  originator_score: number;
  timestamp: number;
}

export interface WalletAnalysisResult {
  wallet: string;
  classification: string;
  leadership_stats: WalletLeadershipStats;
  discovery_history: DiscoveryHistoryEntry[];
}

export interface ScoredWallet {
  position: number;
  wallet: string;
  originator_score: number;
  follower_score: number;
  time_from_launch_ms: number;
  amount_lamports: number;
  classification: string;
}

export interface TokenAnalysisResult {
  token_analysis: {
    token_address: string;
    token_name: string;
    token_symbol: string;
    launch_time: number;
    total_buyers: number;
  };
  leading_wallets: ScoredWallet[];
  follower_wallets: ScoredWallet[];
}

export interface WalletBriefing {
  wallet: string;
  wallet_snippet: string;
  classification: string;
  originator_score: number;
  follower_score: number;
  total_pairs: number;
  early_buyer_count: number;
  recent_activity: Array<{
    token: string;
    symbol: string;
    position: number;
    timestamp: number;
  }>;
}

type StateChangeCallback = () => void;

class AppStateManager {
  mode: AppMode = 'ecosystem';
  analysisType: AnalysisType = null;
  targetAddress: string | null = null;
  analysisResult: WalletAnalysisResult | TokenAnalysisResult | null = null;
  isLoading = false;
  error: string | null = null;

  private listeners: StateChangeCallback[] = [];

  on(cb: StateChangeCallback): void {
    this.listeners.push(cb);
  }

  emit(): void {
    this.listeners.forEach((cb) => cb());
  }

  setMode(mode: AppMode): void {
    this.mode = mode;
    // Clear analysis data when switching modes
    if (mode === 'ecosystem') {
      this.analysisType = null;
      this.targetAddress = null;
      this.analysisResult = null;
      this.error = null;
      this.isLoading = false;
    }
    this.emit();
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
    this.emit();
  }

  setError(msg: string | null): void {
    this.error = msg;
    this.isLoading = false;
    this.emit();
  }

  setAnalysisResult(
    type: AnalysisType,
    address: string,
    result: WalletAnalysisResult | TokenAnalysisResult
  ): void {
    this.analysisType = type;
    this.targetAddress = address;
    this.analysisResult = result;
    this.isLoading = false;
    this.error = null;
    this.emit();
  }

  reset(): void {
    this.analysisType = null;
    this.targetAddress = null;
    this.analysisResult = null;
    this.isLoading = false;
    this.error = null;
    this.emit();
  }
}

export const appState = new AppStateManager();
