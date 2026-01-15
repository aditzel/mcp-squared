/**
 * Backup utilities for the install command.
 *
 * Provides functions to safely backup config files before modification.
 *
 * @module install/backup
 */

import { copyFileSync, existsSync } from "node:fs";

/**
 * Creates a backup of a file before modification.
 *
 * Backup naming strategy:
 * - First backup: `file.json.bak`
 * - Subsequent backups: `file.json.2026-01-13T12-30-45.bak`
 *
 * @param filePath - Path to the file to backup
 * @returns Path to the backup file, or undefined if file doesn't exist
 *
 * @example
 * ```ts
 * const backupPath = createBackup("/path/to/config.json");
 * if (backupPath) {
 *   console.log(`Backed up to: ${backupPath}`);
 * }
 * ```
 */
export function createBackup(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const backupPath = `${filePath}.bak`;

  // If a .bak already exists, use timestamp to avoid overwriting
  if (existsSync(backupPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const timestampedBackupPath = `${filePath}.${timestamp}.bak`;
    copyFileSync(filePath, timestampedBackupPath);
    return timestampedBackupPath;
  }

  copyFileSync(filePath, backupPath);
  return backupPath;
}

/**
 * Creates a backup of a file asynchronously.
 *
 * @param filePath - Path to the file to backup
 * @returns Promise resolving to backup path, or undefined if file doesn't exist
 */
export async function createBackupAsync(
  filePath: string,
): Promise<string | undefined> {
  const { copyFile } = await import("node:fs/promises");

  if (!existsSync(filePath)) {
    return undefined;
  }

  const backupPath = `${filePath}.bak`;

  if (existsSync(backupPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const timestampedBackupPath = `${filePath}.${timestamp}.bak`;
    await copyFile(filePath, timestampedBackupPath);
    return timestampedBackupPath;
  }

  await copyFile(filePath, backupPath);
  return backupPath;
}
