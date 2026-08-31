import { Connection, PublicKey } from '@solana/web3.js';
import EventEmitter from 'eventemitter3';
import { CONFIG, logger } from '../config';
import { PumpFunToken } from '../types';

// ============================================================
// PATIENT ZERO — Pump.fun New Pair Monitor (Solana on-chain)
// Listens for pump.fun Create events directly on Solana.
// Rotates across multiple RPC connections to avoid rate limits.
// ============================================================

interface PumpFunMonitorEvents {
  newPair: [PumpFunToken];
  error: [Error];
}

export class PumpFunMonitor extends EventEmitter<PumpFunMonitorEvents> {
  // One Connection per RPC endpoint — round-robin between them for tx fetches
  private connections: Connection[];
  private rrIndex = 0;

  // WS subscription lives on the first connection only
  private wsConnection: Connection;
  private subscriptionId: number | null = null;

  private seenMints: Set<string> = new Set();
  private activePairs: PumpFunToken[] = [];
  private running = false;

  // Throttle queue — 1 tx fetch per 2s per connection slot
  private queue: string[] = [];
  private processing = false;

  constructor() {
    super();

    // Build one Connection per endpoint
    this.connections = CONFIG.RPC_HTTP_ENDPOINTS.map(
      (url) => new Connection(url, 'confirmed')
    );

    // WebSocket subscription always on the first key's connection
    this.wsConnection = this.connections[0];

    logger.info(
      `PumpFunMonitor: ${this.connections.length} RPC connection(s) configured`
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('PumpFunMonitor starting (Solana on-chain, rotating RPC)…');

    try {
      const programId = new PublicKey(CONFIG.PUMPFUN_PROGRAM_ID);

      this.subscriptionId = this.wsConnection.onLogs(
        programId,
        (logs) => {
          if (!this.running) return;
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

      logger.info(
        `PumpFunMonitor subscribed (sub=${this.subscriptionId}) — ${this.connections.length} RPC endpoint(s) in rotation`
      );
    } catch (err) {
      logger.error('PumpFunMonitor failed to start', err);
      this.emit('error', err as Error);
    }
  }

  stop(): void {
    this.running = false;
    this.queue = [];
    if (this.subscriptionId !== null) {
      this.wsConnection
        .removeOnLogsListener(this.subscriptionId)
        .catch(() => {});
      this.subscriptionId = null;
    }
    logger.info('PumpFunMonitor stopped');
  }

  getActivePairs(): PumpFunToken[] {
    return [...this.activePairs];
  }

  /** Pick the next connection in round-robin order. */
  private nextConnection(): Connection {
    const conn = this.connections[this.rrIndex % this.connections.length];
    this.rrIndex++;
    return conn;
  }

  /** Drain queue one item at a time with a small delay between each fetch. */
  private drainQueue(): void {
    if (this.processing || !this.running) return;
    this.processing = true;

    const delay = Math.max(500, Math.floor(2_000 / this.connections.length));

    const processNext = async (): Promise<void> => {
      if (!this.running || this.queue.length === 0) {
        this.processing = false;
        return;
      }

      // Drop queue overflow (keep newest 30)
      if (this.queue.length > 30) {
        const dropped = this.queue.splice(0, this.queue.length - 30).length;
        logger.debug(`Queue overflow — dropped ${dropped} old signatures`);
      }

      const sig = this.queue.shift()!;
      await this.handleNewPair(sig).catch((err) =>
        logger.warn('handleNewPair failed', (err as Error).message)
      );

      await new Promise<void>((r) => setTimeout(r, delay));
      await processNext();
    };

    processNext().catch((err) => {
      this.processing = false;
      logger.warn('drainQueue error', err);
    });
  }

  private async handleNewPair(signature: string): Promise<void> {
    const conn = this.nextConnection();

    const tx = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx?.transaction?.message?.accountKeys) return;

    const accounts = tx.transaction.message.accountKeys;
    if (accounts.length < 3) return;

    // Pump.fun Create instruction account layout:
    //   [0] mint          ← new token mint address
    //   [1] mintAuthority
    //   [2] bondingCurve
    const mintAddress = accounts[0].pubkey.toBase58();
    if (this.seenMints.has(mintAddress)) return;
    this.seenMints.add(mintAddress);

    const bondingCurve = accounts[2]?.pubkey?.toBase58() ?? '';
    const timestamp = tx.blockTime ? tx.blockTime * 1000 : Date.now();

    const token: PumpFunToken = {
      mint: mintAddress,
      name: mintAddress.slice(0, 8),
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
