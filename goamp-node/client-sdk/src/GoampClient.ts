import { GoampEventEmitter } from "./events.js";
import { CatalogClient } from "./catalog.js";
import { ProfilesClient } from "./profiles.js";
import type { GoampEventType, HealthStatus, Peer } from "./types.js";

export interface GoampClientOptions {
  /** Base URL of the goamp-node HTTP API. Default: http://localhost:7472 */
  baseUrl?: string;
  /** Automatically reconnect WebSocket on disconnect. Default: true */
  autoReconnect?: boolean;
}

/**
 * GoampClient is the main entry point for communicating with a goamp-node.
 *
 * @example
 * ```ts
 * const node = new GoampClient()
 * node.on('peer:connected', (payload) => console.log('peer!', payload))
 * const tracks = await node.catalog.search({ q: 'boards of canada' })
 * await node.connect()
 * ```
 */
export class GoampClient {
  readonly catalog: CatalogClient;
  readonly profiles: ProfilesClient;

  private readonly baseUrl: string;
  private readonly events = new GoampEventEmitter();
  private ws: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoReconnect: boolean;
  private closed = false;

  constructor(opts: GoampClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "http://localhost:7472";
    this.autoReconnect = opts.autoReconnect ?? true;
    this.catalog = new CatalogClient(this.baseUrl);
    this.profiles = new ProfilesClient(this.baseUrl);
  }

  /**
   * Open the WebSocket connection to /events.
   * Call this once after creating the client.
   */
  connect(): void {
    this.closed = false;
    this._openWS();
  }

  /** Close the WebSocket and stop reconnecting. */
  disconnect(): void {
    this.closed = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.ws?.close();
    this.ws = null;
  }

  /**
   * Subscribe to a GOAMP event type.
   * Returns an unsubscribe function.
   */
  on<T = unknown>(type: GoampEventType | string, listener: (payload: T) => void): () => void {
    return this.events.on(type, listener);
  }

  /** Get node health status. */
  async health(): Promise<HealthStatus> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`health check failed: ${res.status}`);
    return res.json();
  }

  /** Get connected peers. */
  async peers(): Promise<Peer[]> {
    const res = await fetch(`${this.baseUrl}/peers`);
    if (!res.ok) throw new Error(`peers request failed: ${res.status}`);
    const body = await res.json();
    return body.peers ?? [];
  }

  private _openWS(): void {
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/events";
    this.ws = new WebSocket(wsUrl);

    this.ws.addEventListener("message", (ev) => {
      try {
        const event = JSON.parse(ev.data);
        this.events.emit(event);
      } catch {
        // ignore malformed messages
      }
    });

    this.ws.addEventListener("close", () => {
      if (!this.closed && this.autoReconnect) {
        this.reconnectTimeout = setTimeout(() => this._openWS(), 2000);
      }
    });

    this.ws.addEventListener("error", () => {
      this.ws?.close();
    });
  }
}
