/**
 * OAuth callback server for handling authorization redirects.
 *
 * Creates a temporary local HTTP server to receive OAuth authorization codes
 * when using the authorization_code flow.
 *
 * @module oauth/callback-server
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Result from OAuth callback.
 */
export interface CallbackResult {
  /** Authorization code (on success) */
  code?: string;
  /** Error code (on failure) */
  error?: string;
  /** Error description */
  errorDescription?: string;
  /** OAuth state parameter */
  state?: string;
}

/**
 * Options for the callback server.
 */
export interface CallbackServerOptions {
  /** Port to listen on (default: 8089) */
  port?: number;
  /** Path for callback endpoint (default: /callback) */
  path?: string;
  /** Timeout in ms before giving up (default: 300000 = 5 minutes) */
  timeoutMs?: number;
}

/**
 * HTML response sent to browser after callback.
 */
function getSuccessHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Authorization Complete</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 { color: #22c55e; margin-bottom: 10px; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Complete</h1>
    <p>You can close this window and return to your terminal.</p>
  </div>
  <script>
    // Try to close the window after a short delay
    setTimeout(() => { window.close(); }, 2000);
  </script>
</body>
</html>`;
}

/**
 * Escapes HTML special characters to prevent XSS attacks.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * HTML response sent to browser on error.
 */
function getErrorHtml(error: string, description?: string): string {
  const safeError = escapeHtml(error);
  const safeDescription = description ? escapeHtml(description) : undefined;

  return `<!DOCTYPE html>
<html>
<head>
  <title>Authorization Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 { color: #ef4444; margin-bottom: 10px; }
    p { color: #666; }
    .error { font-family: monospace; background: #fee; padding: 10px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p class="error">${safeError}${safeDescription ? `: ${safeDescription}` : ""}</p>
    <p>Please close this window and try again.</p>
  </div>
</body>
</html>`;
}

/**
 * Local HTTP server for receiving OAuth callbacks.
 *
 * Creates a temporary server that listens for the OAuth redirect,
 * extracts the authorization code, and returns it to the caller.
 */
export class OAuthCallbackServer {
  private server: Server | null = null;
  private readonly port: number;
  private readonly path: string;
  private readonly timeoutMs: number;

  /**
   * Creates a new callback server.
   *
   * @param options - Server options
   */
  constructor(options: CallbackServerOptions = {}) {
    this.port = options.port ?? 8089;
    this.path = options.path ?? "/callback";
    this.timeoutMs = options.timeoutMs ?? 300_000; // 5 minutes
  }

  /**
   * Starts the server and waits for a callback.
   *
   * @returns Promise that resolves with the callback result
   * @throws Error if server fails to start or times out
   */
  async waitForCallback(): Promise<CallbackResult> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const timeoutId = setTimeout(() => {
        fail(new Error(`OAuth callback timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        this.stop();
      };

      const complete = (result: CallbackResult) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      const fail = (error: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(error);
      };

      // Create server
      this.server = createServer((req, res) => {
        // Only handle the callback path
        const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);

        if (url.pathname !== this.path) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }

        // Parse callback parameters
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        const errorDescription = url.searchParams.get("error_description");
        const state = url.searchParams.get("state");

        // Send response to browser
        res.writeHead(200, { "Content-Type": "text/html" });
        if (error) {
          res.end(getErrorHtml(error, errorDescription ?? undefined));
        } else {
          res.end(getSuccessHtml());
        }

        // Complete the promise
        const result: CallbackResult = {};
        if (code) result.code = code;
        if (error) result.error = error;
        if (errorDescription) result.errorDescription = errorDescription;
        if (state) result.state = state;
        complete(result);
      });

      // Handle server errors
      this.server.on("error", (err) => {
        fail(err);
      });

      // Start listening
      this.server.listen(this.port, "127.0.0.1", () => {
        const addr = this.server?.address() as AddressInfo | null;
        if (addr) {
          // Server started successfully
        }
      });
    });
  }

  /**
   * Stops the callback server.
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Gets the full callback URL.
   */
  getCallbackUrl(): string {
    return `http://127.0.0.1:${this.port}${this.path}`;
  }
}
