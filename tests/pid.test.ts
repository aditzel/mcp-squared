import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkForRunningInstance,
  deletePidFile,
  isProcessRunning,
  readPidFile,
  writePidFile,
} from "@/config/pid";

describe("PID file management", () => {
  let tempDir: string;
  let pidPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `mcp-squared-pid-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    pidPath = join(tempDir, "test.pid");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("writePidFile", () => {
    test("writes current process ID to file", () => {
      const pid = writePidFile(pidPath);
      expect(pid).toBe(process.pid);
    });

    test("creates file with correct content", async () => {
      writePidFile(pidPath);
      const content = await Bun.file(pidPath).text();
      expect(content).toBe(String(process.pid));
    });

    test("overwrites existing file", () => {
      writePidFile(pidPath);
      const firstPid = readPidFile(pidPath);
      writePidFile(pidPath);
      const secondPid = readPidFile(pidPath);
      expect(firstPid).toBe(secondPid);
    });
  });

  describe("readPidFile", () => {
    test("returns null when file does not exist", () => {
      const pid = readPidFile(pidPath);
      expect(pid).toBeNull();
    });

    test("returns valid PID from file", () => {
      const testPid = 12345;
      writeFileSync(pidPath, String(testPid));
      const pid = readPidFile(pidPath);
      expect(pid).toBe(testPid);
    });

    test("handles whitespace in file", () => {
      const testPid = 12345;
      writeFileSync(pidPath, `  ${testPid}  \n`);
      const pid = readPidFile(pidPath);
      expect(pid).toBe(testPid);
    });

    test("returns null for invalid PID (zero)", () => {
      writeFileSync(pidPath, "0");
      const pid = readPidFile(pidPath);
      expect(pid).toBeNull();
    });

    test("returns null for invalid PID (negative)", () => {
      writeFileSync(pidPath, "-1");
      const pid = readPidFile(pidPath);
      expect(pid).toBeNull();
    });

    test("returns null for non-numeric content", () => {
      writeFileSync(pidPath, "not-a-number");
      const pid = readPidFile(pidPath);
      expect(pid).toBeNull();
    });

    test("returns null for empty file", () => {
      writeFileSync(pidPath, "");
      const pid = readPidFile(pidPath);
      expect(pid).toBeNull();
    });
  });

  describe("deletePidFile", () => {
    test("returns true when file does not exist", () => {
      const result = deletePidFile(pidPath);
      expect(result).toBe(true);
    });

    test("deletes existing file and returns true", async () => {
      writeFileSync(pidPath, "12345");
      const result = deletePidFile(pidPath);
      expect(result).toBe(true);
      expect(await Bun.file(pidPath).exists()).toBe(false);
    });

    test("returns true for non-existent path", () => {
      const nonExistentPath = join(tempDir, "non-existent.pid");
      const result = deletePidFile(nonExistentPath);
      expect(result).toBe(true);
    });
  });

  describe("isProcessRunning", () => {
    test("returns false for invalid PID (zero)", () => {
      expect(isProcessRunning(0)).toBe(false);
    });

    test("returns false for invalid PID (negative)", () => {
      expect(isProcessRunning(-1)).toBe(false);
    });

    test("returns true for current process", () => {
      expect(isProcessRunning(process.pid)).toBe(true);
    });

    test("returns false for non-existent PID", () => {
      // Use a very high PID that's unlikely to exist
      expect(isProcessRunning(9999999)).toBe(false);
    });
  });

  describe("checkForRunningInstance", () => {
    test("returns null when PID file does not exist", () => {
      const pid = checkForRunningInstance(pidPath);
      expect(pid).toBeNull();
    });

    test("returns null when PID file contains invalid PID", () => {
      writeFileSync(pidPath, "invalid");
      const pid = checkForRunningInstance(pidPath);
      expect(pid).toBeNull();
    });

    test("returns null when PID file contains non-running PID", () => {
      writeFileSync(pidPath, "9999999");
      const pid = checkForRunningInstance(pidPath);
      expect(pid).toBeNull();
    });

    test("returns PID when process is running", () => {
      writePidFile(pidPath);
      const pid = checkForRunningInstance(pidPath);
      expect(pid).toBe(process.pid);
    });

    test("cleans up stale PID file", async () => {
      writeFileSync(pidPath, "9999999");
      checkForRunningInstance(pidPath);
      expect(await Bun.file(pidPath).exists()).toBe(false);
    });

    test("does not delete PID file for running process", async () => {
      writePidFile(pidPath);
      checkForRunningInstance(pidPath);
      expect(await Bun.file(pidPath).exists()).toBe(true);
    });
  });

  describe("edge cases", () => {
    test("handles concurrent PID file writes", () => {
      const pids: number[] = [];
      for (let i = 0; i < 10; i++) {
        pids.push(writePidFile(pidPath));
      }
      // All writes should succeed and return the same PID
      expect(pids.every((pid) => pid === process.pid)).toBe(true);
    });

    test("handles PID file with special characters", () => {
      const specialPath = join(tempDir, "test with spaces.pid");
      const pid = writePidFile(specialPath);
      expect(pid).toBe(process.pid);
      expect(readPidFile(specialPath)).toBe(process.pid);
    });

    test("handles very large PID values", () => {
      const largePid = 2147483647; // Max int32
      writeFileSync(pidPath, String(largePid));
      const pid = readPidFile(pidPath);
      expect(pid).toBe(largePid);
    });
  });
});
