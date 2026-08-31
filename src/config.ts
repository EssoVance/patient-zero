import * as dotenv from 'dotenv';
dotenv.config();

// ============================================================
// PATIENT ZERO — Centralised Configuration
// ============================================================

export const CONFIG = {
  // ── Solana RPC ──────────────────────────────────────────
  RPC_WS_ENDPOINT:
    process.env.RPC_WS_ENDPOINT || 'wss://api.mainnet-beta.solana.com',
  RPC_HTTP_ENDPOINT:
    process.env.RPC_HTTP_ENDPOINT || 'https://api.mainnet-beta.solana.com',

  // Rotating HTTP endpoints — comma-separated Helius (or any) RPC URLs.
  // e.g. RPC_HTTP_ENDPOINTS=https://mainnet.helius-rpc.com/?api-key=AAA,https://mainnet.helius-rpc.com/?api-key=BBB,...
  // Falls back to RPC_HTTP_ENDPOINT if not set.
  RPC_HTTP_ENDPOINTS: process.env.RPC_HTTP_ENDPOINTS
    ? process.env.RPC_HTTP_ENDPOINTS.split(',').map((u) => u.trim()).filter(Boolean)
    : [process.env.RPC_HTTP_ENDPOINT || 'https://api.mainnet-beta.solana.com'],

  // ── On-chain programs ───────────────────────────────────
  PUMPFUN_PROGRAM_ID: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  RAYDIUM_PROGRAM_ID: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',

  // ── Pump.fun REST API (Heroku backup — same format as frontend-api) ──
  PUMPFUN_API: 'https://client-api-2-74b1891ee9f9.herokuapp.com',
  PUMPFUN_POLL_INTERVAL_MS: 15_000,

  // ── Graph parameters ────────────────────────────────────
  /** If B buys within this window after A, create a directed edge A→B */
  TIME_WINDOW_MS: 5 * 60 * 1000,
  /** Rolling window of data to retain */
  DATA_RETENTION_MS: 24 * 60 * 60 * 1000,
  /** MVP: track the N most recently launched pairs */
  MAX_PAIRS_TRACKED: 10,

  // ── Originator scoring thresholds ───────────────────────
  ORIGINATOR_THRESHOLD: parseFloat(
    process.env.ORIGINATOR_THRESHOLD ?? '0.7'
  ),
  MIXED_THRESHOLD: parseFloat(process.env.MIXED_THRESHOLD ?? '0.4'),
  /** Minimum trade observations before a score is trusted */
  MIN_OBSERVATIONS: 3,
  /** p-value above which an edge is marked coincidence */
  PVALUE_THRESHOLD: 0.05,

  // ── Server ──────────────────────────────────────────────
  WS_PORT: parseInt(process.env.WS_PORT ?? '8080'),
  REST_PORT: parseInt(process.env.REST_PORT ?? '3001'),
  /** How often to push graph state to WebSocket clients */
  BROADCAST_INTERVAL_MS: 2_000,
  /** How often to rebuild edges + scores */
  GRAPH_UPDATE_INTERVAL_MS: 30_000,
} as const;

// ============================================================
// Logger
// ============================================================

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

function log(level: LogLevel, msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, data);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

export const logger = {
  info:  (msg: string, data?: unknown) => log('INFO',  msg, data),
  warn:  (msg: string, data?: unknown) => log('WARN',  msg, data),
  error: (msg: string, data?: unknown) => log('ERROR', msg, data),
  debug: (msg: string, data?: unknown) => log('DEBUG', msg, data),
};
