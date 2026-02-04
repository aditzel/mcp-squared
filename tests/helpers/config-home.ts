import { closeSync, mkdirSync, openSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_PATH = join(tmpdir(), "mcp-squared-config-home.lock");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(): Promise<() => void> {
  while (true) {
    try {
      const fd = openSync(LOCK_PATH, "wx");
      return () => {
        try {
          closeSync(fd);
        } catch {}
        try {
          unlinkSync(LOCK_PATH);
        } catch {}
      };
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code !== "EEXIST") {
        throw err;
      }
      await sleep(25);
    }
  }
}

export async function withTempConfigHome(): Promise<{
  dir: string;
  restore: () => void;
}> {
  const release = await acquireLock();
  const original = process.env["XDG_CONFIG_HOME"];
  const dir = join(tmpdir(), `mcp-squared-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  process.env["XDG_CONFIG_HOME"] = dir;

  return {
    dir,
    restore: () => {
      if (original === undefined) {
        delete process.env["XDG_CONFIG_HOME"];
      } else {
        process.env["XDG_CONFIG_HOME"] = original;
      }
      rmSync(dir, { recursive: true, force: true });
      release();
    },
  };
}
