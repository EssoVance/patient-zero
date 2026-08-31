import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from '../config';

// DEX Program IDs to identify swaps
const PUMPFUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const RAYDIUM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

export class LiveAnalyzer {
  
  /**
   * Analyzes a wallet based on its last 50 transactions.
   */
  async analyzeWalletLive(walletAddress: string, apiKey: string) {
    const conn = new Connection(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`);
    let pubKey;
    try {
      pubKey = new PublicKey(walletAddress);
    } catch {
      throw new Error("Invalid wallet address");
    }

    logger.info(`[LiveAnalyzer] Fetching last 50 txs for wallet: ${walletAddress}`);
    const signatures = await conn.getSignaturesForAddress(pubKey, { limit: 50 });
    
    if (signatures.length === 0) {
      return this.generateEmptyWalletResponse(walletAddress);
    }

    // Fetch parsed transactions
    const txs = await conn.getParsedTransactions(
      signatures.map(s => s.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    let dexInteractions = 0;
    const tokensInteracted = new Set<string>();
    const recentActivity = [];

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      const meta = signatures[i];
      if (!tx || !tx.meta) continue;

      // Check if it involves Raydium or Pumpfun
      const involvesDex = tx.transaction.message.accountKeys.some(
        key => {
          const pk = key.pubkey.toBase58();
          return pk === PUMPFUN_PROGRAM_ID || pk === RAYDIUM_PROGRAM_ID;
        }
      );

      if (involvesDex) {
        dexInteractions++;
        
        // Very rough token extraction
        const possibleToken = tx.transaction.message.accountKeys
          .find(k => k.pubkey.toBase58() !== walletAddress && k.pubkey.toBase58() !== PUMPFUN_PROGRAM_ID && k.pubkey.toBase58() !== RAYDIUM_PROGRAM_ID)
          ?.pubkey.toBase58() || 'Unknown';
        
        tokensInteracted.add(possibleToken);

        if (recentActivity.length < 5 && possibleToken !== 'Unknown') {
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
    let score = 0.2 + (activityRatio * 0.6); // Baseline 0.2, up to 0.8 from activity
    
    // Confidence scales with number of transactions found
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
  }

  /**
   * Analyzes a token by looking at its top holders as a proxy for early buyers.
   */
  async analyzeTokenLive(tokenAddress: string, apiKey: string) {
    const conn = new Connection(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`);
    let pubKey;
    try {
      pubKey = new PublicKey(tokenAddress);
    } catch {
      throw new Error("Invalid token address");
    }

    logger.info(`[LiveAnalyzer] Fetching top holders for token: ${tokenAddress}`);
    
    // Get Top Holders
    let largestAccounts;
    try {
      largestAccounts = await conn.getTokenLargestAccounts(pubKey);
    } catch (e) {
      logger.error('Failed to get token largest accounts', e);
      return this.generateEmptyTokenResponse(tokenAddress);
    }

    if (!largestAccounts || !largestAccounts.value) {
      return this.generateEmptyTokenResponse(tokenAddress);
    }

    const topHolders = largestAccounts.value.slice(0, 10);
    const buyerSequence = [];
    const topOriginators = [];

    for (let i = 0; i < topHolders.length; i++) {
      const acc = topHolders[i];
      let ownerAddress = acc.address.toBase58(); 
      try {
        const parsedAcc = await conn.getParsedAccountInfo(acc.address);
        const data = (parsedAcc.value?.data as any)?.parsed?.info;
        if (data && data.owner) {
          ownerAddress = data.owner;
        }
      } catch (e) {
        // Fallback
      }

      const score = Math.max(0.1, 0.95 - (i * 0.08)); 
      
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
