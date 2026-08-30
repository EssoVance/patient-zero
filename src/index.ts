import { CONFIG, logger } from './config';
import { graphStore } from './storage/graphStore';
import { solanaConn } from './rpc/solanaConnection';
import { pumpfunMonitor } from './rpc/pumpfunMonitor';
import { transactionParser } from './parser/transactionParser';
import { walletTimingExtractor } from './parser/walletTimingExtractor';
import { temporalEdgeBuilder } from './graph/temporalEdgeBuilder';
import { coincidenceCorrector } from './graph/coincidenceCorrector';
import { originatorScorer } from './graph/originatorScorer';
import { pageRankCentrality } from './graph/pageRankCentrality';
import { wsServer } from './api/wsServer';
import { startRestServer } from './api/restServer';
import { PumpFunToken } from './types';

// ════════════════════════════════════════════════════════════
// PATIENT ZERO — Main Entry Point
// Wires: Pump.fun Monitor → Tx Parser → Graph → Scorer → WS
// ════════════════════════════════════════════════════════════

const BANNER = `
╔═══════════════════════════════════════╗
║   PATIENT ZERO — BIOLUMINESCENCE      ║
║   Solana Cascade Originator Network   ║
║   WebSocket: ws://localhost:${CONFIG.WS_PORT}      ║
║   REST API:  http://localhost:${CONFIG.REST_PORT}    ║
╚═══════════════════════════════════════╝
`;

// Per-pair subscription IDs so we can clean up
const pairSubscriptions = new Map<string, number>();

// ── Graph Update Pipeline ────────────────────────────────────

async function runGraphUpdate(): Promise<void> {
  const state = graphStore.getState();
  if (state.nodes.size === 0) return;

  try {
    // 1. Rebuild timing patterns
    for (const node of state.nodes.values()) {
      node.timingPattern = walletTimingExtractor.computeTimingPattern(
        node,
        state.pairs
      );
    }

    // 2. Build temporal edges
    const rawEdges = temporalEdgeBuilder.buildEdgesForAllPairs(state.pairs);

    // 3. Coincidence correction
    const correctedEdges = coincidenceCorrector.correct(rawEdges, state.nodes);

    // 4. Store corrected edges
    graphStore.replaceEdges(correctedEdges);

    // 5. Bayesian originator scoring
    originatorScorer.scoreAll(state.nodes, state.pairs, correctedEdges);

    // 6. PageRank blend
    const pageRanks = pageRankCentrality.compute(state.nodes, correctedEdges);
    pageRankCentrality.enhanceScoresWithPageRank(state.nodes, pageRanks);

    // 7. Reclassify wallet buckets in pairs
    originatorScorer.classifyWallets(state.nodes, state.pairs);

    logger.info(
      `Graph update complete — ${state.nodes.size} nodes, ${correctedEdges.length} edges`
    );
  } catch (err) {
    logger.error('Graph update failed', err);
  }
}

// ── New Pair Handler ─────────────────────────────────────────

async function handleNewPair(token: PumpFunToken): Promise<void> {
  const pairId = token.mint;
  logger.info(`Tracking new pair: ${token.symbol} / ${pairId}`);

  // Subscribe to Pump.fun program logs for this pair
  const subId = await solanaConn.subscribeToLogs(
    CONFIG.PUMPFUN_PROGRAM_ID,
    async (logs, signature) => {
      // Fast-path log check before fetching full tx
      const event = await transactionParser.parseLogsForSwaps(
        logs,
        signature,
        pairId,
        token.createdTimestamp
      );

      if (!event) return;

      // Filter to only swaps on this specific pair (mint match check)
      if (event.pairId !== pairId) return;

      graphStore.addSwapEvent(event);

      // Trigger graph update after every 5 new events on a pair
      const state = graphStore.getState();
      const pair = state.pairs.get(pairId);
      if (pair && pair.buyerSequence.length % 5 === 0) {
        await runGraphUpdate();
      }
    }
  );

  pairSubscriptions.set(pairId, subId);
}

// ── Broadcast Loop ────────────────────────────────────────────

function startBroadcastLoop(): void {
  setInterval(() => {
    wsServer.broadcast(graphStore.serialize());
  }, CONFIG.BROADCAST_INTERVAL_MS);
}

// ── Scheduled Graph Refresh ───────────────────────────────────

function startGraphRefreshLoop(): void {
  setInterval(async () => {
    await runGraphUpdate();
  }, CONFIG.GRAPH_UPDATE_INTERVAL_MS);
}

// ── Graceful Shutdown ─────────────────────────────────────────

function setupShutdown(): void {
  const shutdown = async () => {
    logger.info('Shutting down PATIENT ZERO…');
    pumpfunMonitor.stop();
    for (const [, subId] of pairSubscriptions) {
      await solanaConn.unsubscribe(subId);
    }
    wsServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ── Bootstrap ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(BANNER);

  // Start servers
  startRestServer();
  wsServer.start();

  // Wire Pump.fun monitor
  pumpfunMonitor.on('newPair', (token) => {
    handleNewPair(token).catch((err) =>
      logger.error('handleNewPair failed', err)
    );
  });

  pumpfunMonitor.on('error', (err) => {
    logger.warn('PumpFun monitor error', err);
  });

  // Start loops
  startBroadcastLoop();
  startGraphRefreshLoop();

  // Start monitoring
  pumpfunMonitor.start();

  setupShutdown();

  logger.info('PATIENT ZERO is live — monitoring Solana for new pairs…');
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
