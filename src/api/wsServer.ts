import { WebSocketServer as WsServer, WebSocket } from 'ws';
import { GraphStateSerialized } from '../types';
import { CONFIG, logger } from '../config';

// ============================================================
// PATIENT ZERO — WebSocket Server
// Broadcasts live GraphState snapshots to connected frontends.
// ============================================================

class PatientZeroWsServer {
  private wss: WsServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  start(): void {
    this.wss = new WsServer({ port: CONFIG.WS_PORT });

    this.wss.on('listening', () => {
      logger.info(`WebSocket server listening on ws://localhost:${CONFIG.WS_PORT}`);
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.info(`WS client connected (total: ${this.clients.size})`);

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info(`WS client disconnected (total: ${this.clients.size})`);
      });

      ws.on('error', (err) => {
        logger.warn('WS client error', err);
        this.clients.delete(ws);
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

  broadcast(data: GraphStateSerialized): void {
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
