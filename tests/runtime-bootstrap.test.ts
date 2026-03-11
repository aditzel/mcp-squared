import { describe, expect, mock, test } from "bun:test";
import {
  buildCliInstanceEntry,
  registerShutdownHooks,
  resolveDaemonSharedSecret,
  resolveLauncherHint,
} from "@/cli/runtime-bootstrap";

describe("cli runtime bootstrap helpers", () => {
  test("buildCliInstanceEntry uses common process metadata", () => {
    const entry = buildCliInstanceEntry({
      configPath: "/tmp/config.toml",
      id: "daemon-123",
      launcher: "cursor",
      processRef: {
        argv: ["bun", "run", "mcp-squared"],
        cwd: () => "/worktree",
        pid: 4242,
      },
      role: "daemon",
      socketPath: "/tmp/daemon.sock",
      startedAt: 1000,
      version: "0.8.0",
    });

    expect(entry).toEqual({
      command: "bun run mcp-squared",
      configPath: "/tmp/config.toml",
      cwd: "/worktree",
      id: "daemon-123",
      launcher: "cursor",
      pid: 4242,
      role: "daemon",
      socketPath: "/tmp/daemon.sock",
      startedAt: 1000,
      version: "0.8.0",
    });
  });

  test("registerShutdownHooks wires signals, exit cleanup, and optional stdin events", async () => {
    const signalHandlers = new Map<string, () => void>();
    const stdinHandlers = new Map<string, () => void>();
    const shutdown = mock(async (_exitCode: number) => {});
    const onExit = mock(() => {});

    registerShutdownHooks({
      includeStdin: true,
      onExit,
      processRef: {
        argv: [],
        cwd: () => "/tmp",
        env: {},
        exit: (() => undefined) as unknown as never,
        on: ((event: string, listener: () => void) => {
          signalHandlers.set(event, listener);
        }) as never,
        pid: 1,
        stdin: {
          on: ((event: string, listener: () => void) => {
            stdinHandlers.set(event, listener);
          }) as never,
        },
      },
      shutdown,
    });

    signalHandlers.get("SIGINT")?.();
    signalHandlers.get("SIGTERM")?.();
    stdinHandlers.get("close")?.();
    stdinHandlers.get("end")?.();
    signalHandlers.get("exit")?.();

    expect(shutdown).toHaveBeenCalledTimes(4);
    expect(shutdown).toHaveBeenNthCalledWith(1, 0);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("resolveLauncherHint and resolveDaemonSharedSecret honor precedence and trim env values", () => {
    expect(
      resolveLauncherHint({
        MCP_CLIENT_NAME: "claude",
        MCP_SQUARED_AGENT: "fallback",
      }),
    ).toBe("claude");
    expect(
      resolveDaemonSharedSecret(undefined, {
        MCP_SQUARED_DAEMON_SECRET: "  token  ",
      }),
    ).toBe("token");
    expect(resolveDaemonSharedSecret(undefined, {})).toBeUndefined();
  });
});
