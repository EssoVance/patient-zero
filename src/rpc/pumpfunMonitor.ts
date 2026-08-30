import { Connection, PublicKey } from '@solana/web3.js';
import EventEmitter from 'eventemitter3';
import { CONFIG, logger } from '../config';
import { PumpFunToken } from '../types';

// ============================================================
// PATIENT ZERO — Pump.fun New Pair Monitor (Solana on-chain)
// Listens for pump.fun Create events directly on-chain.
// Throttled to 1 tx fetch per 3s to avoid public RPC rate limits.
// ============================================================

interface PumpFunMonitorEvents {
  newPair: [PumpFunToken];
  error: [Error];
}

export class PumpFunMonitor extends EventEmitter<PumpFunMonitorEvents> {
  private connection: Connection;
  private seenMints: Set<string> = new Set();
  private activePairs: PumpFunToken[] = [];
  private subscriptionId: number | null = null;
  private running = false;

  // Throttle queue — process max 1 tx fetch every 3 seconds
  private queue: string[] = [];
  private processing = false;

  constructor() {
    super();
    this.connection = new Connection(CONFIG.RPC_HTTP_ENDPOINT, {
      commitment: 'confirmed',
      // Politely cap concurrent requests
      httpHeaders: { 'Content-Type': 'application/json' },
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('PumpFunMonitor starting (Solana on-chain mode)…');

    try {
      const programId = new PublicKey(CONFIG.PUMPFUN_PROGRAM_ID);

      this.subscriptionId = this.connection.onLogs(
        programId,
        (logs) => {
          if (!this.running) return;
          // Only queue genuine Create events; skip duplicates and errors
          if (
            !logs.err &&
            logs.logs.some((l) => l.includes('Instruction: Create')) &&
            !this.queue.includes(logs.signature)
          ) {
            this.queue.push(logs.signature);
            this.drainQueue();
          }
        },
        'confirmed'
      );

      logger.info(`PumpFunMonitor subscribed to program logs (sub=${this.subscriptionId})`);
    } catch (err) {
      logger.error('PumpFunMonitor failed to start', err);
      this.emit('error', err as Error);
    }
  }

  stop(): void {
    this.running = false;
    this.queue = [];
    if (this.subscriptionId !== null) {
      this.connection.removeOnLogsListener(this.subscriptionId).catch(() => {});
      this.subscriptionId = null;
    }
    logger.info('PumpFunMonitor stopped');
  }

  getActivePairs(): PumpFunToken[] {
    return [...this.activePairs];
  }

  /** Drain queue one item at a time, with 3s gap between fetches. */
  private drainQueue(): void {
    if (this.processing || !this.running) return;
    this.processing = true;

    const processNext = async (): Promise<void> => {
      if (!this.running || this.queue.length === 0) {
        this.processing = false;
        return;
      }

      // Keep queue from growing unbounded — drop old entries if > 20
      if (this.queue.length > 20) {
        const dropped = this.queue.splice(0, this.queue.length - 20);
        logger.debug(`Queue overflow — dropped ${dropped.length} old signatures`);
      }

      const sig = this.queue.shift()!;
      await this.handleNewPair(sig).catch((err) =>
        logger.warn('handleNewPair failed', (err as Error).message)
      );

      // Wait 3 seconds before next fetch to respect public RPC rate limits
      await new Promise<void>((r) => setTimeout(r, 3_000));
      await processNext();
    };

    processNext().catch((err) => {
      this.processing = false;
      logger.warn('drainQueue error', err);
    });
  }

  private async handleNewPair(signature: string): Promise<void> {
    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx?.transaction?.message?.accountKeys) return;

    const accounts = tx.transaction.message.accountKeys;
    if (accounts.length < 3) return;

    // Pump.fun Create instruction account layout:
    //   [0] mint        ← new token mint address
    //   [1] mintAuthority
    //   [2] bondingCurve
    const mintAddress = accounts[0].pubkey.toBase58();
    if (this.seenMints.has(mintAddress)) return;
    this.seenMints.add(mintAddress);

    const bondingCurve = accounts[2]?.pubkey?.toBase58() ?? '';
    const timestamp = tx.blockTime ? tx.blockTime * 1000 : Date.now();
    const shortMint = mintAddress.slice(0, 8);

    const token: PumpFunToken = {
      mint: mintAddress,
      name: shortMint,
      symbol: mintAddress.slice(0, 4).toUpperCase(),
      createdTimestamp: timestamp,
      bondingCurve,
    };

    this.activePairs.push(token);
    this.activePairs.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    if (this.activePairs.length > CONFIG.MAX_PAIRS_TRACKED) {
      this.activePairs = this.activePairs.slice(0, CONFIG.MAX_PAIRS_TRACKED);
    }

    logger.info(`New pair detected on-chain: ${token.mint}`);
    this.emit('newPair', token);
  }
}

export const pumpfunMonitor = new PumpFunMonitor();
