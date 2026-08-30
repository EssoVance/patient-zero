# PATIENT ZERO — Project Context

## What This Project Is

PATIENT ZERO (Codename: BIOLUMINESCENCE) is a live ecosystem-wide Solana analytics system that identifies who genuinely originates buying cascades on new token pairs versus who only copies after a cascade is already moving.

It uses temporal diffusion graphs (borrowed from epidemiology) and Bayesian inference to produce a continuous "originator vs follower" score for every wallet active on new Pump.fun pairs. The output is a live 3D bioluminescent visualization rendered in Three.js — designed for a campaign launch targeting the crypto-Twitter audience.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 20 + TypeScript (strict) |
| Statistical analysis | Python 3.11 + numpy + scipy |
| 3D Visualization | Three.js r165 |
| Frontend bundler | Vite 5 |
| WebSocket | `ws` library (server) + native WebSocket (client) |
| REST API | Express 4 + CORS |
| GIF rendering | Puppeteer + gif-encoder-2 |
| Data sources | Solana public RPC, Pump.fun API, Raydium API |
| Storage | In-memory (24h rolling window) |
| Deployment | Frontend → Vercel, Backend → Railway |

## Architecture

```
Pump.fun API (poll every 15s)
    ↓ new pair event
Solana RPC (logsSubscribe per program)
    ↓ raw logs + signatures
TransactionParser (fast log check → full tx fetch)
    ↓ SwapEvent
WalletTimingExtractor → WalletNode upsert
    ↓
GraphStore (in-memory, 24h window)
    ↓ every 30s
TemporalEdgeBuilder → CoincidenceCorrector → OriginatorScorer → PageRankCentrality
    ↓
Updated scores → GraphStore
    ↓ every 2s
WebSocket Server → broadcast GraphStateSerialized
    ↓
Frontend (Three.js) ← WsClient ← live data
```

## Key Design Decisions

- **Empirical Bayes shrinkage**: Prevents wallets with few observations from getting extreme scores. Shrinkage factor = n / (n + 3) — wallets with ≥ 10 trades have scores that are 77%+ driven by observed behaviour.
- **Time window = 5 minutes**: If B buys within 5 min of A on the same pair, a directed edge A→B is created. Tunable via CONFIG.
- **PageRank blend**: Final score = 70% Bayesian score + 30% PageRank. Ensures ecosystem-level influence matters, not just per-pair timing.
- **Public RPC only**: Zero cost. Rate-limited, but sufficient for MVP (top 10 pairs).
- **In-memory storage**: Simplest approach for 7-day MVP. 24h rolling window keeps memory bounded.

## Scope Boundaries (MVP)

- Top 10 most recently launched pairs per session
- Last 24 hours of wallet data
- No persistent database (data resets on restart)
- No user authentication
- No cross-session historical analysis

## External APIs Used

- `https://frontend-api.pump.fun/coins` — new pair detection
- `wss://api.mainnet-beta.solana.com` — Solana WebSocket RPC
- `https://api.mainnet-beta.solana.com` — Solana HTTP RPC (transaction fetch)
