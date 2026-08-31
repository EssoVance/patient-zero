import axios from 'axios';
import * as https from 'https';
import { logger } from '../config';

// DEX Program IDs to identify swaps
const PUMPFUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

// Force IPv4 to avoid ENETUNREACH on Render's IPv6-broken network
const ipv4Agent = new https.Agent({ family: 4 });

// ============================================================
// PATIENT ZERO - Live Analyzer (Blueprint 3.0)
// Uses direct HTTPS JSON-RPC calls via axios.
// Only uses confirmed Solana JSON-RPC spec methods.
// ============================================================

export class LiveAnalyzer {

  private async rpc(apiKey: string, method: string, params: any[]): Promise<any> {
    const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    const response = await axios.post(url, {
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    }, {
      timeout: 30000,
      httpsAgent: ipv4Agent   // Force IPv4 — fixes ENETUNREACH on Render
    });

    if (response.data.error) {
      throw new Error(`RPC Error: ${JSON.stringify(response.data.error)}`);
    }
    return response.data.result;
  }

  /**
   * Analyzes a wallet based on its last 50 transactions.
   * Uses getSignaturesForAddress (no per-tx parsing needed for scoring).
   */
  async analyzeWalletLive(walletAddress: string, apiKey: string) {
    try {
      if (!walletAddress || walletAddress.length < 32 || walletAddress.length > 44) {
        throw new Error('Invalid wallet address format');
      }

      logger.info(`[LiveAnalyzer] Fetching signatures for wallet: ${walletAddress}`);

      // getSignaturesForAddress — standard Solana RPC ✓
      const signatures = await this.rpc(apiKey, 'getSignaturesForAddress', [
        walletAddress,
        { limit: 50, commitment: 'confirmed' }
      ]);

      if (!signatures || signatures.length === 0) {
        return this.generateEmptyWalletResponse(walletAddress);
      }

      // Each sig entry: { signature, slot, blockTime, err, memo }
      const successfulTxs = signatures.filter((s: any) => !s.err);
      const totalTxs = signatures.length;
      const successRate = successfulTxs.length / totalTxs;

      // Look at individual transactions for DEX detection
      // Use getTransaction (singular) — standard RPC ✓
      // We only fetch a small sample (5) to keep latency low
      const sampleSigs = signatures.slice(0, 5);
      let dexInteractions = 0;
      const recentActivity: any[] = [];

      for (const sigEntry of sampleSigs) {
        try {
          const tx = await this.rpc(apiKey, 'getTransaction', [
            sigEntry.signature,
            { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }
          ]);

          if (!tx || !tx.transaction) continue;

          const accountKeys: string[] = tx.transaction.message.accountKeys.map((k: any) =>
            typeof k === 'string' ? k : (k.pubkey ?? k)
          );

          const involvesDex = accountKeys.includes(PUMPFUN_PROGRAM_ID) || accountKeys.includes(RAYDIUM_PROGRAM_ID);

          if (involvesDex) {
            dexInteractions++;

            // Find a token address (skip system/dex/wallet keys)
            const systemKeys = new Set([
              walletAddress,
              PUMPFUN_PROGRAM_ID,
              RAYDIUM_PROGRAM_ID,
              '11111111111111111111111111111111',
              'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              'SysvarRent111111111111111111111111111111111',
              'ComputeBudget111111111111111111111111111111'
            ]);
            const possibleToken = accountKeys.find(k => !systemKeys.has(k));

            if (recentActivity.length < 5 && possibleToken) {
              recentActivity.push({
                token_address: possibleToken,
                token_name: possibleToken.slice(0, 6),
                entry_time: new Date((sigEntry.blockTime || 0) * 1000).toISOString(),
                relative_timing: 'recent',
                estimated_position: 'unknown'
              });
            }
          }
        } catch (_e) {
          // Skip failed individual tx fetches
        }
      }

      // Score: base on DEX activity in our sample + success rate
      const sampleDexRate = dexInteractions / Math.max(sampleSigs.length, 1);
      const score = Math.min(0.95, 0.2 + sampleDexRate * 0.65 + successRate * 0.15);
      const confidence = Math.min(1.0, totalTxs / 50);
      const adjustedScore = score * confidence;

      let classification = 'likely_follower';
      if (adjustedScore >= 0.7) classification = 'genuine_originator';
      else if (adjustedScore >= 0.4) classification = 'mixed';

      return {
        wallet: walletAddress,
        wallet_snippet: walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4),
        analysis_basis: `last_${totalTxs}_transactions`,
        transaction_count: totalTxs,
        classification,
        originator_score: Math.round(adjustedScore * 100) / 100,
        confidence: Math.round(confidence * 100) / 100,
        leadership_indicators: {
          early_entry_rate: Math.round(sampleDexRate * 100) / 100,
          timing_consistency: Math.round(successRate * 100) / 100,
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
   * Uses getTokenLargestAccounts + getAccountInfo (both standard RPC ✓)
   */
  async analyzeTokenLive(tokenAddress: string, apiKey: string) {
    try {
      if (!tokenAddress || tokenAddress.length < 32 || tokenAddress.length > 44) {
        throw new Error('Invalid token address format');
      }

      logger.info(`[LiveAnalyzer] Fetching top holders for token: ${tokenAddress}`);

      // getTokenLargestAccounts — standard Solana RPC ✓
      const result = await this.rpc(apiKey, 'getTokenLargestAccounts', [
        tokenAddress,
        { commitment: 'confirmed' }
      ]);

      if (!result || !result.value || result.value.length === 0) {
        return this.generateEmptyTokenResponse(tokenAddress);
      }

      const topHolders = result.value.slice(0, 10);
      const buyerSequence: any[] = [];
      const topOriginators: any[] = [];

      for (let i = 0; i < topHolders.length; i++) {
        const acc = topHolders[i];
        let ownerAddress = acc.address;

        // getAccountInfo with jsonParsed encoding to resolve token account owner — standard RPC ✓
        try {
          const accInfoResult = await this.rpc(apiKey, 'getAccountInfo', [
            acc.address,
            { encoding: 'jsonParsed', commitment: 'confirmed' }
          ]);
          const owner = accInfoResult?.value?.data?.parsed?.info?.owner;
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
