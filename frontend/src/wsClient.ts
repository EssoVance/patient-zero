// GraphStateSerialized received from WebSocket
export interface WalletNodeData {
  address: string;
  originatorScore: number;
  followerScore: number;
  lastUpdated: number;
  timingPattern?: {
    averageTimeToEntry: number;
    earlyBuyerCount: number;
    totalPairs: number;
  };
}

export interface TemporalEdgeData {
  fromWallet: string;
  toWallet: string;
  pairId: string;
  timeDelta: number;
  edgeType: 'origin' | 'follower' | 'coincidence';
  weight: number;
}

export interface GraphStateSerialized {
  nodes: Array<[string, WalletNodeData]>;
  edges: TemporalEdgeData[];
  pairs: Array<[string, unknown]>;
  lastUpdated: number;
  stats: {
    totalNodes: number;
    totalEdges: number;
    totalPairs: number;
    topOriginators: Array<{ address: string; score: number }>;
  };
}

// ============================================================
// PATIENT ZERO — WebSocket Client
// ============================================================

type UpdateCallback = (state: GraphStateSerialized) => void;
type SimpleCallback = () => void;

class WsClient {
  private ws: WebSocket | null = null;
  private updateCallbacks: UpdateCallback[] = [];
  private connectCallbacks: SimpleCallback[] = [];
  private disconnectCallbacks: SimpleCallback[] = [];
  private retryDelay = 1_000;
  private maxDelay = 30_000;
  private shouldReconnect = true;

  // Configurable endpoint — reads VITE env var or falls back to localhost
  private readonly endpoint =
    (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_WS_URL ||
    'ws://localhost:8080';

  connect(): void {
    try {
      this.ws = new WebSocket(this.endpoint);

      this.ws.onopen = () => {
        console.log('[WsClient] Connected to', this.endpoint);
        this.retryDelay = 1_000;
        this.connectCallbacks.forEach((cb) => cb());

        // Hide loading screen
        const loading = document.getElementById('loading');
        if (loading) loading.classList.add('hidden');
      };

      this.ws.onmessage = (event) => {
        try {
          const state = JSON.parse(event.data as string) as GraphStateSerialized;
          this.updateCallbacks.forEach((cb) => cb(state));
        } catch (err) {
          console.warn('[WsClient] Failed to parse message', err);
        }
      };

      this.ws.onclose = () => {
        console.warn('[WsClient] Disconnected');
        this.disconnectCallbacks.forEach((cb) => cb());
        if (this.shouldReconnect) {
          setTimeout(() => this.connect(), this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[WsClient] Error', err);
      };
    } catch (err) {
      console.error('[WsClient] Failed to create WebSocket', err);
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay);
    }
  }

  onUpdate(cb: UpdateCallback): void {
    this.updateCallbacks.push(cb);
  }

  onConnect(cb: SimpleCallback): void {
    this.connectCallbacks.push(cb);
  }

  onDisconnect(cb: SimpleCallback): void {
    this.disconnectCallbacks.push(cb);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }
}

export const wsClient = new WsClient();
