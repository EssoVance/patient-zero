import { Connection, PublicKey } from '@solana/web3.js';
import EventEmitter from 'eventemitter3';
import { CONFIG, logger } from '../config';
import { PumpFunToken } from '../types';

// ============================================================
// PATIENT ZERO — Pump.fun New Pair Monitor (Solana RPC mode)
// Detects new pair creations directly from on-chain logs.
// No external REST API required — works from any cloud server.
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

  constructor() {
    super();
    this.connection = new Connection(CONFIG.RPC_HTTP_ENDPOINT, 'confirmed');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info('PumpFunMonitor starting (Solana on-chain mode)…');

    try {
      const programId = new PublicKey(CONFIG.PUMPFUN_PROGRAM_ID);

      this.subscriptionId = this.connection.onLogs(
        programId,
        async (logs) => {
          if (!this.running) return;
          // Pump.fun emits "Instruction: Create" for new token launches
          if (logs.logs.some((l) => l.includes('Instruction: Create'))) {
            await this.handleNewPair(logs.signature).catch((err) => {
              logger.warn('handleNewPair error', err);
            });
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
    if (this.subscriptionId !== null) {
      this.connection.removeOnLogsListener(this.subscriptionId).catch(() => {});
      this.subscriptionId = null;
    }
    logger.info('PumpFunMonitor stopped');
  }

  getActivePairs(): PumpFunToken[] {
    return [...this.activePairs];
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

    // Name/symbol not available without metadata fetch; use short mint as placeholder
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
