/**
 * PID file management for MCP server lifecycle.
 *
 * This module handles creating, reading, and deleting PID files to track
 * running server instances.
 *
 * @module config/pid
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Writes the current process ID to a PID file.
 *
 * @param pidPath - Path to the PID file
 * @returns The written process ID
 */
export function writePidFile(pidPath: string): number {
  const pid = process.pid;
  writeFileSync(pidPath, String(pid), { encoding: "utf8" });
  return pid;
}

/**
 * Reads a PID from a PID file.
 *
 * @param pidPath - Path to the PID file
 * @returns The PID if the file exists and contains a valid number, otherwise null
 */
export function readPidFile(pidPath: string): number | null {
  if (!existsSync(pidPath)) {
    return null;
  }

  try {
    const content = readFileSync(pidPath, { encoding: "utf8" }).trim();
    const pid = Number.parseInt(content, 10);

    if (Number.isNaN(pid) || pid <= 0) {
      return null;
    }

    return pid;
  } catch {
    return null;
  }
}

/**
 * Deletes a PID file.
 *
 * @param pidPath - Path to the PID file
 * @returns true if the file was deleted or didn't exist, false if an error occurred
 */
export function deletePidFile(pidPath: string): boolean {
  if (!existsSync(pidPath)) {
    return true;
  }

  try {
    unlinkSync(pidPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a process with the given PID is running.
 *
 * @param pid - Process ID to check
 * @returns true if the process is running, false otherwise
 */
export function isProcessRunning(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }

  try {
    // On Unix-like systems, sending signal 0 to a PID will test if it exists
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    // If the error is ESRCH (no such process), the PID is not running
    return code !== "ESRCH";
  }
}

/**
 * Checks if there's already a running instance of the server by verifying the PID file.
 *
 * @param pidPath - Path to the PID file
 * @returns The PID of the running process if it exists, otherwise null
 */
export function checkForRunningInstance(pidPath: string): number | null {
  const pid = readPidFile(pidPath);

  if (pid === null) {
    return null;
  }

  if (isProcessRunning(pid)) {
    return pid;
  }

  // PID file exists but process is not running - stale file, delete it
  deletePidFile(pidPath);
  return null;
}
