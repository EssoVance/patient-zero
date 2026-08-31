import axios from 'axios';
import { logger } from '../config';

// DEX Program IDs to identify swaps
const PUMPFUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

// ============================================================
// PATIENT ZERO - Live Analyzer (Blueprint 3.0)
// Uses direct HTTPS JSON-RPC calls via axios to avoid Node.js
// fetch() compatibility issues on older Node runtimes.
// ============================================================

export class LiveAnalyzer {

  private async rpc(apiKey: string, method: string, params: any[]): Promise<any> {
    const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    const response = await axios.post(url, {
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    }, { timeout: 30000 });

    if (response.data.error) {
      throw new Error(`RPC Error: ${JSON.stringify(response.data.error)}`);
    }
    return response.data.result;
  }

  /**
   * Analyzes a wallet based on its last 50 transactions.
   */
  async analyzeWalletLive(walletAddress: string, apiKey: string) {
    try {
      // Validate address format
      if (!walletAddress || walletAddress.length < 32 || walletAddress.length > 44) {
        throw new Error('Invalid wallet address format');
      }

      logger.info(`[LiveAnalyzer] Fetching last 50 txs for wallet: ${walletAddress}`);

      // getSignaturesForAddress
      const signatures = await this.rpc(apiKey, 'getSignaturesForAddress', [
        walletAddress,
        { limit: 50 }
      ]);

      if (!signatures || signatures.length === 0) {
        return this.generateEmptyWalletResponse(walletAddress);
      }

      // Fetch parsed transactions in one batch
      const txSigs = signatures.map((s: any) => s.signature);
      const txs = await this.rpc(apiKey, 'getParsedTransactions', [
        txSigs,
        { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }
      ]);

      let dexInteractions = 0;
      const recentActivity: any[] = [];

      for (let i = 0; i < txs.length; i++) {
        const tx = txs[i];
        const meta = signatures[i];
        if (!tx || !tx.meta) continue;

        const accountKeys: string[] = tx.transaction?.message?.accountKeys?.map((k: any) =>
          typeof k === 'string' ? k : k.pubkey
        ) ?? [];

        const involvesDex = accountKeys.includes(PUMPFUN_PROGRAM_ID) || accountKeys.includes(RAYDIUM_PROGRAM_ID);

        if (involvesDex) {
          dexInteractions++;

          // Extract a token address (rough heuristic — pick any non-system, non-dex key)
          const possibleToken = accountKeys.find(k =>
            k !== walletAddress &&
            k !== PUMPFUN_PROGRAM_ID &&
            k !== RAYDIUM_PROGRAM_ID &&
            k !== '11111111111111111111111111111111' &&
            k !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
          );

          if (recentActivity.length < 5 && possibleToken) {
            recentActivity.push({
              token_address: possibleToken,
              token_name: possibleToken.slice(0, 6),
              entry_time: new Date((meta.blockTime || 0) * 1000).toISOString(),
              relative_timing: 'recent',
              estimated_position: 'unknown'
            });
          }
        }
      }

      const activityRatio = dexInteractions / signatures.length;
      const score = Math.min(0.95, 0.2 + activityRatio * 0.6);
      const confidence = Math.min(1.0, signatures.length / 50);
      const adjustedScore = score * confidence;

      let classification = 'likely_follower';
      if (adjustedScore >= 0.7) classification = 'genuine_originator';
      else if (adjustedScore >= 0.4) classification = 'mixed';

      return {
        wallet: walletAddress,
        wallet_snippet: walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4),
        analysis_basis: 'last_50_transactions',
        transaction_count: signatures.length,
        classification,
        originator_score: Math.round(adjustedScore * 100) / 100,
        confidence: Math.round(confidence * 100) / 100,
        leadership_indicators: {
          early_entry_rate: Math.round(activityRatio * 100) / 100,
          timing_consistency: 0.5,
          leadership_evidence: adjustedScore > 0.6 ? 'high' : (adjustedScore > 0.3 ? 'medium' : 'low')
        },
        recent_activity: recentActivity
      };

    } catch (err: any) {
      logger.error('[LiveAnalyzer] analyzeWalletLive failed', err?.message ?? err);
      throw err;
    }
  }

  /**
   * Analyzes a token by looking at its top holders as a proxy for early buyers.
   */
  async analyzeTokenLive(tokenAddress: string, apiKey: string) {
    try {
      if (!tokenAddress || tokenAddress.length < 32 || tokenAddress.length > 44) {
        throw new Error('Invalid token address format');
      }

      logger.info(`[LiveAnalyzer] Fetching top holders for token: ${tokenAddress}`);

      // getTokenLargestAccounts
      const result = await this.rpc(apiKey, 'getTokenLargestAccounts', [tokenAddress]);
      
      if (!result || !result.value || result.value.length === 0) {
        return this.generateEmptyTokenResponse(tokenAddress);
      }

      const topHolders = result.value.slice(0, 10);
      const buyerSequence: any[] = [];
      const topOriginators: any[] = [];

      for (let i = 0; i < topHolders.length; i++) {
        const acc = topHolders[i];
        let ownerAddress = acc.address;

        // Resolve the token account to its owner wallet
        try {
          const parsedAccResult = await this.rpc(apiKey, 'getParsedAccountInfo', [acc.address]);
          const owner = parsedAccResult?.value?.data?.parsed?.info?.owner;
          if (owner) ownerAddress = owner;
        } catch (_e) {
          // Keep fallback to token account address
        }

        const score = Math.max(0.1, 0.95 - i * 0.08);
        let classification = 'likely_follower';
        if (score >= 0.7) classification = 'genuine_originator';
        else if (score >= 0.4) classification = 'mixed';

        const buyer = {
          position: i + 1,
          wallet: ownerAddress,
          wallet_snippet: ownerAddress.slice(0, 6) + '...' + ownerAddress.slice(-4),
          classification,
          originator_score: Math.round(score * 100) / 100,
          entry_timestamp: new Date().toISOString(),
          evidence: i < 3 ? 'top_holder_likely_early' : 'significant_holder'
        };

        buyerSequence.push(buyer);
        if (score >= 0.7) {
          topOriginators.push({
            position: i + 1,
            wallet: ownerAddress,
            originator_score: Math.round(score * 100) / 100
          });
        }
      }

      return {
        token_analysis: {
          token_address: tokenAddress,
          token_name: tokenAddress.slice(0, 8),
          token_symbol: 'TOKEN',
          total_buyers_analyzed: topHolders.length,
          analysis_basis: 'top_current_holders'
        },
        buyer_sequence: buyerSequence,
        top_originators: topOriginators
      };

    } catch (err: any) {
      logger.error('[LiveAnalyzer] analyzeTokenLive failed', err?.message ?? err);
      throw err;
    }
  }

  private generateEmptyWalletResponse(wallet: string) {
    return {
      wallet,
      wallet_snippet: wallet.slice(0, 6) + '...' + wallet.slice(-4),
      analysis_basis: 'last_50_transactions',
      transaction_count: 0,
      classification: 'unknown',
      originator_score: 0,
      confidence: 0,
      leadership_indicators: {
        early_entry_rate: 0,
        timing_consistency: 0,
        leadership_evidence: 'none'
      },
      recent_activity: []
    };
  }

  private generateEmptyTokenResponse(token: string) {
    return {
      token_analysis: {
        token_address: token,
        token_name: 'Unknown',
        token_symbol: '???',
        total_buyers_analyzed: 0,
        analysis_basis: 'top_current_holders'
      },
      buyer_sequence: [],
      top_originators: []
    };
  }
}

export const liveAnalyzer = new LiveAnalyzer();
