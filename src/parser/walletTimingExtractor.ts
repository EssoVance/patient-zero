import { SwapEvent, WalletNode, PairNode, TimingPattern } from '../types';

// ============================================================
// PATIENT ZERO — Wallet Timing Extractor
// ============================================================

export class WalletTimingExtractor {
  /**
   * Update or create a WalletNode from a swap event.
   */
  processSwapEvent(
    event: SwapEvent,
    walletNodes: Map<string, WalletNode>
  ): WalletNode {
    const existing = walletNodes.get(event.wallet);
    const now = Date.now();

    if (!existing) {
      const node: WalletNode = {
        address: event.wallet,
        entries: [],
        exits: [],
        timingPattern: {
          averageTimeToEntry: 0,
          earlyBuyerCount: 0,
          totalPairs: 0,
        },
        originatorScore: 0.5,
        followerScore: 0.5,
        lastUpdated: now,
      };

      if (event.side === 'buy') {
        node.entries.push({
          timestamp: event.timestamp,
          pairId: event.pairId,
          amount: event.amount,
        });
      } else {
        node.exits.push({
          timestamp: event.timestamp,
          pairId: event.pairId,
          amount: event.amount,
        });
      }

      walletNodes.set(event.wallet, node);
      return node;
    }

    // Avoid duplicate entries for the same wallet+pair combo
    const alreadyRecorded = existing.entries.some(
      (e) => e.pairId === event.pairId
    );

    if (!alreadyRecorded) {
      if (event.side === 'buy') {
        existing.entries.push({
          timestamp: event.timestamp,
          pairId: event.pairId,
          amount: event.amount,
        });
      } else {
        existing.exits.push({
          timestamp: event.timestamp,
          pairId: event.pairId,
          amount: event.amount,
        });
      }
    }

    existing.lastUpdated = now;
    return existing;
  }

  /**
   * Compute timing statistics for a wallet given the full pair map.
   */
  computeTimingPattern(
    node: WalletNode,
    pairs: Map<string, PairNode>
  ): TimingPattern {
    let totalTimeToEntry = 0;
    let count = 0;
    let earlyBuyerCount = 0;

    for (const entry of node.entries) {
      const pair = pairs.get(entry.pairId);
      if (!pair) continue;

      const timeToEntry = entry.timestamp - pair.launchTime;
      if (timeToEntry < 0) continue; // ignore pre-launch entries

      totalTimeToEntry += timeToEntry;
      count++;

      // Check if this wallet was in first 5 buyers for this pair
      const position = pair.buyerSequence.findIndex(
        (b) => b.wallet === node.address
      );
      if (position !== -1 && position < 5) {
        earlyBuyerCount++;
      }
    }

    return {
      averageTimeToEntry: count > 0 ? totalTimeToEntry / count : 0,
      earlyBuyerCount,
      totalPairs: count,
    };
  }

  /**
   * Sort swap events by timestamp, keep only the earliest buy per wallet per pair.
   */
  extractBuyerSequence(
    events: SwapEvent[]
  ): Array<{ wallet: string; timestamp: number; amount: number }> {
    const buyEvents = events.filter((e) => e.side === 'buy');
    buyEvents.sort((a, b) => a.timestamp - b.timestamp);

    // Deduplicate: keep first entry per wallet
    const seen = new Set<string>();
    const deduped: Array<{ wallet: string; timestamp: number; amount: number }> = [];

    for (const ev of buyEvents) {
      if (!seen.has(ev.wallet)) {
        seen.add(ev.wallet);
        deduped.push({
          wallet: ev.wallet,
          timestamp: ev.timestamp,
          amount: ev.amount,
        });
      }
    }

    return deduped;
  }
}

export const walletTimingExtractor = new WalletTimingExtractor();
