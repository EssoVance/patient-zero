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
  private connection: Connection;
  private subscriptionIds: Map<number, string> = new Map();

  constructor() {
    super();
    this.connection = new Connection(CONFIG.RPC_HTTP_ENDPOINT, {
      wsEndpoint: CONFIG.RPC_WS_ENDPOINT,
      commitment: 'confirmed',
    });
    logger.info(`SolanaConnection initialised → ${CONFIG.RPC_HTTP_ENDPOINT}`);
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
    const subId = this.connection.onLogs(
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
   * Fetch a full transaction by signature.
   */
  async getTransaction(
    signature: string
  ): Promise<VersionedTransactionResponse | null> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      return tx;
    } catch (err) {
      logger.warn(`getTransaction failed for ${signature}`, err);
      return null;
    }
  }

  /**
   * Remove a log subscription.
   */
  async unsubscribe(subId: number): Promise<void> {
    try {
      await this.connection.removeOnLogsListener(subId);
      this.subscriptionIds.delete(subId);
      logger.info(`Unsubscribed logs sub ${subId}`);
    } catch (err) {
      logger.warn(`Failed to unsubscribe sub ${subId}`, err);
    }
  }

  async getSlot(): Promise<number> {
    return this.connection.getSlot();
  }

  getConnection(): Connection {
    return this.connection;
  }
}

export const solanaConn = new SolanaConnection();
