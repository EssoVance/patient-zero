# PATIENT ZERO — Handoff

## Session Summary
Full initial build. All source files written in one session.

## Current State
- All TypeScript source files written ✅
- Frontend Three.js files written ✅
- Python stats bridge written ✅
- Tests written ✅

**Status: NEEDS npm install + pip install before running**

## Next Steps (Priority Order)
1. `cd patient-zero && npm install`
2. `pip install -r requirements.txt`
3. `npm test` — verify all tests pass
4. `npm run dev` — start backend (RPC + graph engine)
5. `npm run frontend` — start Three.js visualization at http://localhost:5173
6. Wait 60 seconds for first Pump.fun pair data to arrive
7. `npm run render-gif` — capture campaign GIF (after step 4+5 are running)
8. Push to GitHub, deploy frontend to Vercel, backend to Railway

## Important Context
- Config in `src/config.ts` — all thresholds tunable without code changes
- Public Solana RPC may have rate limits; switch endpoint in `.env` if needed
- `VITE_WS_URL` env var in Vercel must point to Railway backend WebSocket URL
- Python stats bridge in `python/stats_bridge.py` — called via child_process if needed
- GIF renderer requires `canvas` npm package: `npm install canvas`

## Continuation Prompt
Read PROJECT_CONTEXT.md and HANDOFF.md. This is PATIENT ZERO — Solana wallet originator scoring with bioluminescent Three.js visualization. Run `npm install && pip install -r requirements.txt && npm run dev:all` to start. First priority: run tests with `npm test`.
