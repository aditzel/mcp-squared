/**
 * Cross-platform browser opener for OAuth flows.
 *
 * Opens the default browser to a URL for user authorization.
 * Gracefully falls back to logging the URL if browser can't be opened.
 *
 * @module oauth/browser
 */

import { spawn } from "node:child_process";

/**
 * Opens the default browser to the specified URL.
 *
 * Platform-specific commands:
 * - macOS: `open "url"`
 * - Linux: `xdg-open "url"`
 * - Windows: `start "" "url"`
 *
 * @param url - URL to open in the browser
 * @returns Promise that resolves when browser is launched (not when user finishes)
 * @throws Error if browser cannot be opened and fallback logging fails
 */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;

  let command: string;
  let args: string[];

  switch (platform) {
    case "darwin":
      command = "open";
      args = [url];
      break;
    case "win32":
      command = "cmd";
      args = ["/c", "start", "", url];
      break;
    default:
      // Linux and other Unix-like systems
      command = "xdg-open";
      args = [url];
      break;
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    child.on("error", () => {
      // Browser couldn't be opened, log the URL as fallback
      console.error(
        `\nCould not open browser automatically. Please open this URL manually:\n`,
      );
      console.error(`  ${url}\n`);
      // Resolve anyway since user can open manually
      resolve();
    });

    child.on("spawn", () => {
      // Detach from parent process so it doesn't block
      child.unref();
      resolve();
    });
  });
}

/**
 * Logs an authorization URL for the user to open manually.
 * Used as fallback when browser can't be opened automatically.
 *
 * @param url - URL to display
 */
export function logAuthorizationUrl(url: string): void {
  console.error(`\nPlease open this URL in your browser to authorize:\n`);
  console.error(`  ${url}\n`);
  console.error(`Waiting for authorization...\n`);
}
