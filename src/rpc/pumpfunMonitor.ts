import axios from 'axios';
import EventEmitter from 'eventemitter3';
import { CONFIG, logger } from '../config';
import { PumpFunToken } from '../types';

// ============================================================
// PATIENT ZERO — Pump.fun New Pair Monitor
// ============================================================

interface PumpFunApiCoin {
  mint: string;
  name: string;
  symbol: string;
  created_timestamp: number;
  bonding_curve: string;
}

interface PumpFunMonitorEvents {
  newPair: [PumpFunToken];
  error: [Error];
}

export class PumpFunMonitor extends EventEmitter<PumpFunMonitorEvents> {
  private seenMints: Set<string> = new Set();
  private activePairs: PumpFunToken[] = [];
  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;
  private retryDelay = 1_000;

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('PumpFunMonitor started');
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('PumpFunMonitor stopped');
  }

  getActivePairs(): PumpFunToken[] {
    return [...this.activePairs];
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    try {
      const response = await axios.get<PumpFunApiCoin[]>(
        `${CONFIG.PUMPFUN_API}/newest`,
        { timeout: 10_000 }
      );

      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1_000;

      const freshCoins = response.data.filter(
        (c) => c.created_timestamp > oneHourAgo
      );

      for (const coin of freshCoins) {
        if (!this.seenMints.has(coin.mint)) {
          this.seenMints.add(coin.mint);
          const token: PumpFunToken = {
            mint: coin.mint,
            name: coin.name,
            symbol: coin.symbol,
            createdTimestamp: coin.created_timestamp,
            bondingCurve: coin.bonding_curve,
          };
          this.activePairs.push(token);
          // Keep only MAX_PAIRS_TRACKED by most recent
          this.activePairs.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
          if (this.activePairs.length > CONFIG.MAX_PAIRS_TRACKED) {
            this.activePairs = this.activePairs.slice(0, CONFIG.MAX_PAIRS_TRACKED);
          }
          logger.info(`New pair detected: ${token.symbol} (${token.mint})`);
          this.emit('newPair', token);
        }
      }

      this.retryDelay = 1_000; // reset on success
    } catch (err) {
      logger.warn(`PumpFun poll failed (retry in ${this.retryDelay}ms)`, err);
      this.emit('error', err as Error);
      // Exponential backoff, cap at 60s
      this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
    }

    this.pollTimer = setTimeout(
      () => this.poll(),
      this.retryDelay > 1_000 ? this.retryDelay : CONFIG.PUMPFUN_POLL_INTERVAL_MS
    );
  }
}

export const pumpfunMonitor = new PumpFunMonitor();
