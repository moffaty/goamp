# Multi-Device Sync — Plan 4.5: Session/Remote Client Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Wire the P4 session+commands endpoints to the Tauri+TS layer so the frontend can: push its session state, pull remote commands, and send commands to another device. Keep Rust stateless (HTTP proxy only); the polling loop lives in TypeScript.

**Architecture:** Four thin Tauri commands mirror the four node endpoints (`/session/{put,get}`, `/commands/{post,pull}`), loading `sub_sk` from keychain per call. A `RemoteService` in TS exposes typed wrappers, plus helpers to start/stop a polling interval that fires a callback per command.

**Out of scope:** Actual wiring of commands to the Webamp player (the `onCommand` callback is the seam — concrete UI handlers live in a later UI plan). Stale-device detection UI. Takeover dialog.

---

## File Map

**Modify (Rust):**
- `src-tauri/src/commands/account.rs` — add 4 commands
- `src-tauri/src/lib.rs` — register handlers

**Modify (TS):**
- `src/services/interfaces.ts` — `IRemoteService` + types
- `src/services/index.ts` — export
- Create: `src/services/RemoteService.ts`, `src/services/RemoteService.test.ts`

---

## Task 1: Tauri commands

Append to `src-tauri/src/commands/account.rs`:

```rust
#[tauri::command]
pub fn remote_put_session(
    account_pub: String,
    relay_url: String,
    session_json: String,
) -> Result<(), String> {
    let a = acct::load_account(&account_pub).map_err(|e| format!("keychain: {}", e))?;
    let resp = http()
        .post(format!("{}/session/put", NODE_BASE))
        .json(&serde_json::json!({
            "account_pub": account_pub,
            "sub_sk_b64": a.sub_sk_b64,
            "relay_url": relay_url,
            "session_json": session_json,
        }))
        .send()
        .map_err(|e| format!("node request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("node status: {}", resp.status()));
    }
    Ok(())
}

#[tauri::command]
pub fn remote_get_session(
    account_pub: String,
    relay_url: String,
) -> Result<String, String> {
    let a = acct::load_account(&account_pub).map_err(|e| format!("keychain: {}", e))?;
    let resp = http()
        .post(format!("{}/session/get", NODE_BASE))
        .json(&serde_json::json!({
            "account_pub": account_pub,
            "sub_sk_b64": a.sub_sk_b64,
            "relay_url": relay_url,
        }))
        .send()
        .map_err(|e| format!("node request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("node status: {}", resp.status()));
    }
    let body: Value = resp.json().map_err(|e| format!("decode: {}", e))?;
    Ok(body["session_json"].as_str().unwrap_or("").to_string())
}

#[tauri::command]
pub fn remote_send_command(
    account_pub: String,
    relay_url: String,
    command_json: String,
) -> Result<(), String> {
    let a = acct::load_account(&account_pub).map_err(|e| format!("keychain: {}", e))?;
    let resp = http()
        .post(format!("{}/commands/post", NODE_BASE))
        .json(&serde_json::json!({
            "account_pub": account_pub,
            "sub_sk_b64": a.sub_sk_b64,
            "relay_url": relay_url,
            "command_json": command_json,
        }))
        .send()
        .map_err(|e| format!("node request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("node status: {}", resp.status()));
    }
    Ok(())
}

#[tauri::command]
pub fn remote_pull_commands(
    account_pub: String,
    relay_url: String,
) -> Result<Vec<String>, String> {
    let a = acct::load_account(&account_pub).map_err(|e| format!("keychain: {}", e))?;
    let resp = http()
        .post(format!("{}/commands/pull", NODE_BASE))
        .json(&serde_json::json!({
            "account_pub": account_pub,
            "sub_sk_b64": a.sub_sk_b64,
            "relay_url": relay_url,
        }))
        .send()
        .map_err(|e| format!("node request: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("node status: {}", resp.status()));
    }
    let body: Value = resp.json().map_err(|e| format!("decode: {}", e))?;
    let mut out = Vec::new();
    if let Some(arr) = body["commands"].as_array() {
        for c in arr {
            if let Some(s) = c.as_str() {
                out.push(s.to_string());
            }
        }
    }
    Ok(out)
}
```

Register in `src-tauri/src/lib.rs` `generate_handler!`:

```rust
        commands::account::remote_put_session,
        commands::account::remote_get_session,
        commands::account::remote_send_command,
        commands::account::remote_pull_commands,
```

- [ ] **Verify** — `cd src-tauri && cargo check && cargo fmt`.

- [ ] **Commit** — `feat(tauri): remote session/commands proxy commands`.

---

## Task 2: TS RemoteService

Create `src/services/RemoteService.ts`:

```ts
import type { ITransport } from "./transport";
import type { IRemoteService, RemoteCommand, RemoteSession, RemotePoller } from "./interfaces";

export class RemoteService implements IRemoteService {
  constructor(private readonly t: ITransport) {}

  async putSession(accountPub: string, relayUrl: string, session: RemoteSession): Promise<void> {
    await this.t.call("remote_put_session", {
      accountPub,
      relayUrl,
      sessionJson: JSON.stringify(session),
    });
  }

  async getSession(accountPub: string, relayUrl: string): Promise<RemoteSession | null> {
    const raw = (await this.t.call("remote_get_session", {
      accountPub,
      relayUrl,
    })) as string;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RemoteSession;
    } catch {
      return null;
    }
  }

  async sendCommand(accountPub: string, relayUrl: string, cmd: RemoteCommand): Promise<void> {
    await this.t.call("remote_send_command", {
      accountPub,
      relayUrl,
      commandJson: JSON.stringify(cmd),
    });
  }

  async pullCommands(accountPub: string, relayUrl: string): Promise<RemoteCommand[]> {
    const raws = (await this.t.call("remote_pull_commands", {
      accountPub,
      relayUrl,
    })) as string[];
    const out: RemoteCommand[] = [];
    for (const r of raws) {
      try {
        out.push(JSON.parse(r) as RemoteCommand);
      } catch {
        // skip malformed
      }
    }
    return out;
  }

  /**
   * Start two intervals:
   *   - Every `commandsIntervalMs` (default 1000): pullCommands → onCommand for each
   *   - Every `sessionIntervalMs` (default 2000): getSession → onSession (active=false)
   *     OR: if `sessionProvider` is set, putSession with its return value (active=true)
   * Returns a handle; call .stop() to cancel both intervals.
   */
  startPoller(opts: {
    accountPub: string;
    relayUrl: string;
    onCommand: (cmd: RemoteCommand) => void;
    onSession?: (session: RemoteSession | null) => void;
    sessionProvider?: () => RemoteSession | null;
    commandsIntervalMs?: number;
    sessionIntervalMs?: number;
  }): RemotePoller {
    const commandsMs = opts.commandsIntervalMs ?? 1000;
    const sessionMs = opts.sessionIntervalMs ?? 2000;
    let stopped = false;

    const cmdTick = async () => {
      if (stopped) return;
      try {
        const cmds = await this.pullCommands(opts.accountPub, opts.relayUrl);
        for (const c of cmds) opts.onCommand(c);
      } catch {
        // swallow — transient network; next tick retries
      }
    };
    const sessionTick = async () => {
      if (stopped) return;
      try {
        if (opts.sessionProvider) {
          const s = opts.sessionProvider();
          if (s) await this.putSession(opts.accountPub, opts.relayUrl, s);
        } else if (opts.onSession) {
          const s = await this.getSession(opts.accountPub, opts.relayUrl);
          opts.onSession(s);
        }
      } catch {
        // swallow
      }
    };

    const cmdTimer = setInterval(cmdTick, commandsMs);
    const sessionTimer = setInterval(sessionTick, sessionMs);

    return {
      stop() {
        stopped = true;
        clearInterval(cmdTimer);
        clearInterval(sessionTimer);
      },
    };
  }
}
```

Append to `src/services/interfaces.ts`:

```ts
export interface RemoteTrackRef {
  track_id: string;
  source: string;
  title?: string;
  artist?: string;
  url?: string;
}

export interface RemoteSession {
  version: number;
  active_device_id: string;
  track?: RemoteTrackRef;
  position_ms?: number;
  position_updated_at_ns?: number;
  playback_state?: "playing" | "paused" | "buffering" | "stopped";
  queue?: RemoteTrackRef[];
  queue_position?: number;
  shuffle?: boolean;
  repeat?: "off" | "one" | "all";
  last_heartbeat_ns?: number;
}

export interface RemoteCommand {
  op: "play" | "pause" | "seek" | "next" | "prev" | "add_to_queue" | "set_shuffle" | "set_repeat" | "play_track" | "takeover";
  arg_int?: number;
  arg_str?: string;
  arg_track?: RemoteTrackRef;
  issued_by: string;
  issued_at_ns: number;
  nonce: string;
}

export interface RemotePoller {
  stop(): void;
}

export interface IRemoteService {
  putSession(accountPub: string, relayUrl: string, session: RemoteSession): Promise<void>;
  getSession(accountPub: string, relayUrl: string): Promise<RemoteSession | null>;
  sendCommand(accountPub: string, relayUrl: string, cmd: RemoteCommand): Promise<void>;
  pullCommands(accountPub: string, relayUrl: string): Promise<RemoteCommand[]>;
  startPoller(opts: {
    accountPub: string;
    relayUrl: string;
    onCommand: (cmd: RemoteCommand) => void;
    onSession?: (session: RemoteSession | null) => void;
    sessionProvider?: () => RemoteSession | null;
    commandsIntervalMs?: number;
    sessionIntervalMs?: number;
  }): RemotePoller;
}
```

Export in `src/services/index.ts`: `export { RemoteService } from "./RemoteService";`. Also add a singleton instance alongside other services if that's the pattern.

## Task 2 test

Create `src/services/RemoteService.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { RemoteService } from "./RemoteService";
import type { ITransport } from "./transport";
import type { RemoteCommand, RemoteSession } from "./interfaces";

function mockTransport(handlers: Record<string, (args: unknown) => unknown>): ITransport {
  return {
    call: vi.fn(async (cmd: string, args?: unknown) => handlers[cmd](args)),
  } as unknown as ITransport;
}

describe("RemoteService", () => {
  it("putSession serializes to JSON", async () => {
    const calls: string[] = [];
    const t = mockTransport({
      remote_put_session: (args) => {
        calls.push(JSON.stringify(args));
        return null;
      },
    });
    const svc = new RemoteService(t);
    const s: RemoteSession = { version: 1, active_device_id: "d", playback_state: "playing" };
    await svc.putSession("abc", "http://r", s);
    expect(calls).toHaveLength(1);
    const parsed = JSON.parse(calls[0]);
    expect(parsed.accountPub).toBe("abc");
    expect(parsed.relayUrl).toBe("http://r");
    expect(JSON.parse(parsed.sessionJson)).toEqual(s);
  });

  it("getSession parses session JSON; empty → null", async () => {
    const svc = new RemoteService(mockTransport({
      remote_get_session: () => `{"version":2,"active_device_id":"x"}`,
    }));
    const got = await svc.getSession("abc", "http://r");
    expect(got?.version).toBe(2);

    const svc2 = new RemoteService(mockTransport({
      remote_get_session: () => "",
    }));
    expect(await svc2.getSession("abc", "http://r")).toBeNull();
  });

  it("pullCommands parses array of JSON strings", async () => {
    const svc = new RemoteService(mockTransport({
      remote_pull_commands: () => [
        `{"op":"pause","issued_by":"x","issued_at_ns":1,"nonce":"AA"}`,
        `{"op":"seek","arg_int":42,"issued_by":"y","issued_at_ns":2,"nonce":"BB"}`,
      ],
    }));
    const cmds = await svc.pullCommands("abc", "http://r");
    expect(cmds).toHaveLength(2);
    expect(cmds[0].op).toBe("pause");
    expect(cmds[1].arg_int).toBe(42);
  });

  it("startPoller fires onCommand for each pulled command", async () => {
    const received: RemoteCommand[] = [];
    let pulled = 0;
    const svc = new RemoteService(mockTransport({
      remote_pull_commands: () => {
        pulled += 1;
        if (pulled === 1) {
          return [`{"op":"pause","issued_by":"x","issued_at_ns":1,"nonce":"AA"}`];
        }
        return [];
      },
      remote_get_session: () => "",
    }));
    const poller = svc.startPoller({
      accountPub: "abc",
      relayUrl: "http://r",
      onCommand: (c) => received.push(c),
      onSession: () => {},
      commandsIntervalMs: 5,
      sessionIntervalMs: 1000,
    });
    await new Promise((r) => setTimeout(r, 30));
    poller.stop();
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].op).toBe("pause");
  });
});
```

- [ ] **Verify** — `pnpm test src/services/RemoteService.test.ts` all pass. Then `pnpm test` full suite green.

- [ ] **Commit** — `feat(services): RemoteService — put/get session, send/pull commands, polling`.

---

## Task 3: Milestone

- [ ] `git tag -a multi-device-p4-5-remote-wiring -m "Plan 4.5: client wiring for P4 session/remote"`.

---

## Self-Review

**Spec coverage:** Completes the P4 client wiring so frontend can push session state and receive commands. Actual audio-action hookup (apply `seek` to Webamp, etc.) is out of scope — `onCommand` is the frontend integration point.

**Type consistency:** `RemoteSession`/`RemoteCommand` TS types mirror Go `session.Session`/`session.Command` JSON tags exactly (snake_case preserved).

**Placeholders:** none.
