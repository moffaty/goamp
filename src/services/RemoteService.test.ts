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
