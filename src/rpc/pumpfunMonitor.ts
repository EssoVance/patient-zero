import { Connection, PublicKey } from '@solana/web3.js';
import EventEmitter from 'eventemitter3';
import { CONFIG, logger } from '../config';
import { PumpFunToken } from '../types';

// ============================================================
// PATIENT ZERO — Pump.fun New Pair Monitor (Solana on-chain)
// Listens for pump.fun Create events directly on Solana.
// Rotates across multiple RPC connections to avoid rate limits.
// Has exponential backoff on WS reconnect to avoid 429 storm.
// ============================================================

interface PumpFunMonitorEvents {
  newPair: [PumpFunToken];
  error: [Error];
}

// Reconnect config
const RECONNECT_BASE_MS  = 5_000;   //  5s initial delay
const RECONNECT_MAX_MS   = 120_000; //  2m max delay
const RECONNECT_FACTOR   = 2;       // doubles each attempt

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

  // Throttle queue — 1 tx fetch per slot
  private queue: string[] = [];
  private processing = false;

  // Backoff state
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.reconnectAttempt = 0;
    logger.info('PumpFunMonitor starting (Solana on-chain, rotating RPC)…');
    this._subscribe();
  }

  stop(): void {
    this.running = false;
    this.queue = [];
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._unsubscribe();
    logger.info('PumpFunMonitor stopped');
  }

  getActivePairs(): PumpFunToken[] {
    return [...this.activePairs];
  }

  // ── Private ─────────────────────────────────────────────────

  private _subscribe(): void {
    if (!this.running) return;

    try {
      const programId = new PublicKey(CONFIG.PUMPFUN_PROGRAM_ID);

      this.subscriptionId = this.wsConnection.onLogs(
        programId,
        (logs) => {
          if (!this.running) return;
          // Reset backoff — connection is healthy
          this.reconnectAttempt = 0;

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

      // Attach error handler to underlying WS to catch 429s without crashing
      this._watchWsErrors();

    } catch (err) {
      logger.error('PumpFunMonitor subscribe failed', err);
      this._scheduleReconnect();
    }
  }

  private _unsubscribe(): void {
    if (this.subscriptionId !== null) {
      this.wsConnection
        .removeOnLogsListener(this.subscriptionId)
        .catch(() => {});
      this.subscriptionId = null;
    }
  }

  /**
   * Attach an error/close handler to the internal WS connection that
   * @solana/web3.js creates. If the WS drops or gets a 429 from the
   * server, we unsubscribe cleanly and schedule a reconnect with
   * exponential backoff — instead of hammering the endpoint every second.
   */
  private _watchWsErrors(): void {
    // Access the internal _rpcWebSocket if present (web3.js <= 1.x)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcWs = (this.wsConnection as any)._rpcWebSocket;
    if (!rpcWs) return; // safety — if internal API changes

    const onError = (err: Error) => {
      if (!this.running) return;
      logger.warn(`PumpFun WS error (attempt ${this.reconnectAttempt}): ${err?.message ?? String(err)}`);
      this._unsubscribe();
      this._scheduleReconnect();
    };

    const onClose = () => {
      if (!this.running) return;
      logger.warn(`PumpFun WS closed unexpectedly — scheduling reconnect`);
      this._unsubscribe();
      this._scheduleReconnect();
    };

    // Remove old listeners to avoid duplicates
    rpcWs.removeAllListeners?.('error');
    rpcWs.removeAllListeners?.('close');
    rpcWs.on('error', onError);
    rpcWs.on('close', onClose);
  }

  private _scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, this.reconnectAttempt),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempt++;

    logger.info(
      `PumpFunMonitor reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${this.reconnectAttempt})…`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) {
        // Rotate to next connection to spread load
        this.wsConnection =
          this.connections[this.rrIndex % this.connections.length];
        this.rrIndex++;
        this._subscribe();
      }
    }, delay);
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
