import { WebSocketServer as WsServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { GraphStateSerialized } from '../types';
import { CONFIG, logger } from '../config';

// ============================================================
// PATIENT ZERO — WebSocket Server
// Broadcasts live GraphState snapshots to connected frontends.
// Emits 'active' when the first viewer connects,
// and 'idle' when the last viewer disconnects — so the backend
// can pause Solana monitoring when nobody is watching.
// ============================================================

import * as http from 'http';

class PatientZeroWsServer extends EventEmitter {
  private wss: WsServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  start(server: http.Server): void {
    this.wss = new WsServer({ server });

    this.wss.on('listening', () => {
      logger.info(`WebSocket server attached to HTTP server`);
    });

    this.wss.on('connection', (ws) => {
      const wasIdle = this.clients.size === 0;
      this.clients.add(ws);
      logger.info(`WS client connected (total: ${this.clients.size})`);

      // First viewer connected — wake up Solana monitoring
      if (wasIdle) {
        logger.info('First viewer connected — resuming blockchain monitoring');
        this.emit('active');
      }

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info(`WS client disconnected (total: ${this.clients.size})`);

        // Last viewer left — pause Solana monitoring to save bandwidth
        if (this.clients.size === 0) {
          logger.info('All viewers disconnected — pausing blockchain monitoring');
          this.emit('idle');
        }
      });

      ws.on('error', (err) => {
        logger.warn('WS client error', err);
        this.clients.delete(ws);
        if (this.clients.size === 0) this.emit('idle');
      });

      // Mark alive for heartbeat
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
      ws.on('pong', () => {
        (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
      });
    });

    // Heartbeat — ping all clients every 30s, drop dead ones
    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.clients) {
        const alive = (ws as WebSocket & { isAlive?: boolean }).isAlive;
        if (alive === false) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        (ws as WebSocket & { isAlive?: boolean }).isAlive = false;
        ws.ping();
      }
    }, 30_000);
  }

  /** Number of currently connected frontends. */
  getClientCount(): number {
    return this.clients.size;
  }

  broadcast(data: GraphStateSerialized): void {
    // Only broadcast when at least one frontend is connected
    if (this.clients.size === 0) return;
    const payload = JSON.stringify(data);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  stop(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.wss?.close();
  }
}

export const wsServer = new PatientZeroWsServer();
