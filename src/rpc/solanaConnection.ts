import {
  Connection,
  PublicKey,
  VersionedTransactionResponse,
} from '@solana/web3.js';
import EventEmitter from 'eventemitter3';
import { CONFIG, logger } from '../config';

// ============================================================
// PATIENT ZERO — Solana RPC Connection
// ============================================================

interface SolanaConnectionEvents {
  connected: [];
  disconnected: [];
  error: [Error];
}

export class SolanaConnection extends EventEmitter<SolanaConnectionEvents> {
  // Rotate HTTP connections to avoid rate limits
  private httpConnections: Connection[];
  private httpRrIndex = 0;

  // Single WS connection for subscriptions
  private wsConnection: Connection;
  private subscriptionIds: Map<number, string> = new Map();

  // Throttle queue for getTransaction
  private txQueue: { sig: string; resolve: (res: VersionedTransactionResponse | null) => void }[] = [];
  private processingTx = false;

  constructor() {
    super();

    // Initialize one Connection per endpoint in the config
    this.httpConnections = CONFIG.RPC_HTTP_ENDPOINTS.map(
      (url) => new Connection(url, 'confirmed')
    );

    // The first connection also gets the WS endpoint for logsSubscribe
    this.wsConnection = new Connection(CONFIG.RPC_HTTP_ENDPOINTS[0], {
      wsEndpoint: CONFIG.RPC_WS_ENDPOINT,
      commitment: 'confirmed',
    });

    logger.info(
      `SolanaConnection initialised with ${this.httpConnections.length} rotating HTTP endpoint(s).`
    );
  }

  private nextHttpConnection(): Connection {
    const conn = this.httpConnections[this.httpRrIndex % this.httpConnections.length];
    this.httpRrIndex++;
    return conn;
  }

  /**
   * Subscribe to logs emitted by a given program.
   * Returns the subscription ID (use to unsubscribe later).
   */
  async subscribeToLogs(
    programId: string,
    callback: (logs: string[], signature: string) => void
  ): Promise<number> {
    const pubkey = new PublicKey(programId);
    const subId = this.wsConnection.onLogs(
      pubkey,
      (logsResult) => {
        if (logsResult.err) return;
        callback(logsResult.logs, logsResult.signature);
      },
      'confirmed'
    );
    this.subscriptionIds.set(subId, programId);
    logger.info(`Subscribed to logs for program ${programId} (sub ${subId})`);
    return subId;
  }

  /**
   * Fetch a full transaction by signature (throttled + rotating RPC).
   */
  async getTransaction(
    signature: string
  ): Promise<VersionedTransactionResponse | null> {
    return new Promise((resolve) => {
      this.txQueue.push({ sig: signature, resolve });
      this.drainTxQueue();
    });
  }

  private drainTxQueue(): void {
    if (this.processingTx || this.txQueue.length === 0) return;
    this.processingTx = true;

    // Calculate delay based on how many keys we have (e.g. 5 keys = 100ms per request = 50 req/sec)
    // 500ms total gap across the pool
    const delay = Math.max(100, Math.floor(500 / this.httpConnections.length));

    const processNext = async (): Promise<void> => {
      if (this.txQueue.length === 0) {
        this.processingTx = false;
        return;
      }

      // Drop old queue if backend is falling hopelessly behind (keep newest 100)
      if (this.txQueue.length > 100) {
        const dropped = this.txQueue.splice(0, this.txQueue.length - 100);
        dropped.forEach((req) => req.resolve(null));
        logger.debug(`Dropped ${dropped.length} queued getTransaction calls to keep up`);
      }

      const req = this.txQueue.shift()!;
      const conn = this.nextHttpConnection();

      try {
        const tx = await conn.getTransaction(req.sig, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        });
        req.resolve(tx);
      } catch (err) {
        // Suppress 429 logs to keep console clean, just return null
        req.resolve(null);
      }

      await new Promise((r) => setTimeout(r, delay));
      await processNext();
    };

    processNext().catch((err) => {
      this.processingTx = false;
      logger.warn('drainTxQueue error', err);
    });
  }

  /**
   * Remove a log subscription.
   */
  async unsubscribe(subId: number): Promise<void> {
    try {
      await this.wsConnection.removeOnLogsListener(subId);
      this.subscriptionIds.delete(subId);
      logger.info(`Unsubscribed logs sub ${subId}`);
    } catch (err) {
      logger.warn(`Failed to unsubscribe sub ${subId}`, err);
    }
  }

  async getSlot(): Promise<number> {
    return this.nextHttpConnection().getSlot();
  }
}

export const solanaConn = new SolanaConnection();
