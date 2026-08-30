# PATIENT ZERO — Sprint Tasks

## IN PROGRESS
- [ ] npm install + pip install
- [ ] npm test (verify all tests pass)
- [ ] npm run dev:all (live data test)

## BACKLOG (Priority Order)
- [ ] Push to GitHub (git init → commit → push)
- [ ] Deploy frontend to Vercel
- [ ] Deploy backend to Railway
- [ ] Set VITE_WS_URL in Vercel env vars → Railway WebSocket URL
- [ ] npm run render-gif → campaign GIF output
- [ ] v0.2: Cross-pair coincidence correction (scipy exact binomial via Python bridge)
- [ ] v0.2: Leaderboard page (/leaderboard route in frontend)
- [ ] v0.2: Wallet lookup feature (search box in HUD)
- [ ] v0.2: Token staking for graph sharding (post-campaign)

## COMPLETED
- [x] Blueprint design (PATIENT_ZERO_BLUEPRINT.txt)
- [x] Architecture planning (implementation_plan.md)
- [x] Full codebase initial build
  - [x] src/types/index.ts
  - [x] src/config.ts
  - [x] src/rpc/solanaConnection.ts
  - [x] src/rpc/pumpfunMonitor.ts
  - [x] src/parser/transactionParser.ts
  - [x] src/parser/walletTimingExtractor.ts
  - [x] src/storage/graphStore.ts
  - [x] src/graph/temporalEdgeBuilder.ts
  - [x] src/graph/coincidenceCorrector.ts
  - [x] src/graph/originatorScorer.ts
  - [x] src/graph/pageRankCentrality.ts
  - [x] src/api/wsServer.ts
  - [x] src/api/restServer.ts
  - [x] src/index.ts
  - [x] frontend/index.html
  - [x] frontend/src/main.ts
  - [x] frontend/src/wsClient.ts
  - [x] frontend/src/scene.ts
  - [x] frontend/src/particleSystem.ts
  - [x] frontend/src/edgeRenderer.ts
  - [x] frontend/src/audioManager.ts
  - [x] python/stats_bridge.py
  - [x] scripts/renderGif.ts
  - [x] tests/parser.test.ts
  - [x] tests/graph.test.ts
  - [x] tests/scorer.test.ts
  - [x] vercel.json
  - [x] HANDOFF.md, PROJECT_CONTEXT.md, AGENTS.md
