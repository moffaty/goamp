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
