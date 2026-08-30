import { solanaConn } from '../rpc/solanaConnection';
import { SwapEvent } from '../types';
import { logger } from '../config';

// ============================================================
// PATIENT ZERO — Transaction Parser
// ============================================================

const BUY_KEYWORDS = ['buy', 'Buy', 'BUY', 'swap', 'Swap'];
const SELL_KEYWORDS = ['sell', 'Sell', 'SELL'];

export class TransactionParser {
  /**
   * Fast path: inspect the logs array without fetching the full transaction.
   * Returns a SwapEvent if the logs indicate a swap, null otherwise.
   */
  async parseLogsForSwaps(
    logs: string[],
    signature: string,
    pairId: string,
    launchTime: number
  ): Promise<SwapEvent | null> {
    try {
      const logsText = logs.join(' ');
      const isBuy = BUY_KEYWORDS.some((k) => logsText.includes(k));
      const isSell = SELL_KEYWORDS.some((k) => logsText.includes(k));

      if (!isBuy && !isSell) return null;

      // Fetch full transaction for wallet and amount extraction
      return await this.parseSwap(signature, pairId, launchTime);
    } catch (err) {
      logger.warn(`parseLogsForSwaps failed for ${signature}`, err);
      return null;
    }
  }

  /**
   * Full parse: fetch transaction data and extract swap event details.
   */
  async parseSwap(
    signature: string,
    pairId: string,
    launchTime: number
  ): Promise<SwapEvent | null> {
    try {
      const tx = await solanaConn.getTransaction(signature);
      if (!tx || !tx.blockTime) return null;

      const timestamp = tx.blockTime * 1_000; // convert to ms

      // Extract fee payer as the buyer wallet
      const accountKeys =
        tx.transaction.message.getAccountKeys?.()?.staticAccountKeys ??
        (tx.transaction.message as unknown as { accountKeys: { toBase58(): string }[] }).accountKeys;

      if (!accountKeys || accountKeys.length === 0) return null;
      const wallet = accountKeys[0].toBase58();

      // Determine SOL amount from pre/post balances of the fee payer
      const meta = tx.meta;
      if (!meta) return null;

      const preBal = meta.preBalances[0] ?? 0;
      const postBal = meta.postBalances[0] ?? 0;
      const diff = preBal - postBal; // positive = paid SOL (buy), negative = received SOL (sell)
      const amount = Math.abs(diff);

      // Determine side from logs
      const logsText = (meta.logMessages ?? []).join(' ');
      const isBuy = BUY_KEYWORDS.some((k) => logsText.includes(k));
      const side: 'buy' | 'sell' = isBuy ? 'buy' : 'sell';

      // Only process events after pair launch
      if (timestamp < launchTime) return null;

      return {
        wallet,
        timestamp,
        amount,
        pairId,
        side,
        signature,
      };
    } catch (err) {
      logger.warn(`parseSwap failed for ${signature}`, err);
      return null;
    }
  }
}

export const transactionParser = new TransactionParser();
