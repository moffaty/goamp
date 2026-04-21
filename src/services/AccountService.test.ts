import { describe, it, expect, vi } from "vitest";
import { AccountService } from "./AccountService";
import type { ITransport } from "./transport";

function mockTransport(handlers: Record<string, (args: unknown) => unknown>): ITransport {
  return {
    call: vi.fn(async (cmd: string, args?: unknown) => {
      if (!(cmd in handlers)) throw new Error(`Unexpected command: ${cmd}`);
      return handlers[cmd](args);
    }),
  } as unknown as ITransport;
}

describe("AccountService", () => {
  it("create returns mnemonic and quiz positions", async () => {
    const t = mockTransport({
      account_create: () => ({
        mnemonic: "one two three four five six seven eight nine ten eleven twelve",
        account_pub: "abc",
        quiz_positions: [1, 5, 9],
      }),
    });
    const svc = new AccountService(t);
    const r = await svc.create("Mac", "darwin");
    expect(r.mnemonic.split(" ")).toHaveLength(12);
    expect(r.quizPositions).toEqual([1, 5, 9]);
    expect(r.accountPub).toBe("abc");
  });

  it("current returns null when no account provisioned", async () => {
    const t = mockTransport({ account_current: () => null });
    const svc = new AccountService(t);
    expect(await svc.current()).toBeNull();
  });

  it("verifyQuiz is pure — compares lowercased trimmed words", async () => {
    const t = mockTransport({});
    const svc = new AccountService(t);
    const words = "a b c d e f g h i j k l".split(" ");
    expect(svc.verifyQuiz(words, [1, 5, 9], [" B ", "F", "j"])).toBe(true);
    expect(svc.verifyQuiz(words, [1, 5, 9], ["B", "F", "WRONG"])).toBe(false);
    expect(svc.verifyQuiz(words, [1, 5], ["B", "F", "J"])).toBe(false);
  });

  it("forget issues account_forget command", async () => {
    const calls: string[] = [];
    const t = mockTransport({
      account_forget: (args) => {
        calls.push(JSON.stringify(args));
        return null;
      },
    });
    const svc = new AccountService(t);
    await svc.forget("abc");
    expect(calls).toEqual([`{"accountPub":"abc"}`]);
  });
});
