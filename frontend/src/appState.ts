// ============================================================
// PATIENT ZERO — App State (Dual-Mode Manager)
// ============================================================

export type AppMode = 'ecosystem' | 'analysis';
export type AnalysisType = 'wallet' | 'token' | null;

export interface DiscoveryHistoryEntry {
  token_address: string;
  token_name: string;
  entry_time: string;
  relative_timing: string;
  estimated_position: string;
}

export interface WalletAnalysisResult {
  wallet: string;
  wallet_snippet: string;
  analysis_basis: string;
  transaction_count: number;
  classification: string;
  originator_score: number;
  confidence: number;
  leadership_indicators: {
    early_entry_rate: number;
    timing_consistency: number;
    leadership_evidence: string;
  };
  recent_activity: DiscoveryHistoryEntry[];
}

export interface ScoredWallet {
  position: number;
  wallet: string;
  wallet_snippet: string;
  classification: string;
  originator_score: number;
  entry_timestamp: string;
  evidence: string;
}

export interface TokenAnalysisResult {
  token_analysis: {
    token_address: string;
    token_name: string;
    token_symbol: string;
    total_buyers_analyzed: number;
    analysis_basis: string;
  };
  buyer_sequence: ScoredWallet[];
  top_originators: { position: number; wallet: string; originator_score: number }[];
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
  userApiKey: string = typeof localStorage !== 'undefined' ? (localStorage.getItem('helius_api_key') || '') : '';

  private listeners: StateChangeCallback[] = [];

  on(cb: StateChangeCallback): void {
    this.listeners.push(cb);
  }

  emit(): void {
    this.listeners.forEach((cb) => cb());
  }

  setApiKey(key: string): void {
    this.userApiKey = key.trim();
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('helius_api_key', this.userApiKey);
    }
    this.emit();
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
