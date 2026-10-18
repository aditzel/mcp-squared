import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { OAuthCallbackServer } from "@/oauth/callback-server";

const servers: OAuthCallbackServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

async function freePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string")
    throw new Error("No reserved port");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function callback(options: { path?: string; timeoutMs?: number } = {}) {
  const server = new OAuthCallbackServer({
    port: await freePort(),
    timeoutMs: 1000,
    ...options,
  });
  servers.push(server);
  return server;
}

describe("OAuth callback HTTP lifecycle", () => {
  test("receives code and state, keeps wrong paths pending, and closes the listener", async () => {
    const server = await callback({ path: "/oauth/complete" });
    const pending = server.waitForCallback();
    const wrong = await fetch(
      server.getCallbackUrl().replace("/oauth/complete", "/wrong"),
    );
    expect(wrong.status).toBe(404);
    expect(await wrong.text()).toBe("Not Found");
    const response = await fetch(
      `${server.getCallbackUrl()}?code=hello%20world&state=csrf-value`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toContain("Authorization Complete");
    expect(await pending).toEqual({ code: "hello world", state: "csrf-value" });
    server.stop();
    await expect(fetch(server.getCallbackUrl())).rejects.toThrow();
  });

  test("renders escaped provider errors and returns the original error data", async () => {
    const server = await callback();
    const pending = server.waitForCallback();
    const error = `<script>"&'`;
    const description = `<img src="x">&'`;
    const query = new URLSearchParams({
      error,
      error_description: description,
    });
    const response = await fetch(`${server.getCallbackUrl()}?${query}`);
    const html = await response.text();
    expect(html).toContain("&lt;script&gt;&quot;&amp;&#039;");
    expect(html).toContain("&lt;img src=&quot;x&quot;&gt;&amp;&#039;");
    expect(html).not.toContain(description);
    expect(await pending).toEqual({ error, errorDescription: description });
  });

  test("accepts callbacks without optional fields and errors without descriptions", async () => {
    for (const query of ["", "?error=access_denied"]) {
      const server = await callback();
      const pending = server.waitForCallback();
      const response = await fetch(`${server.getCallbackUrl()}${query}`);
      expect(await response.text()).toContain(
        query ? "Authorization Failed" : "Authorization Complete",
      );
      expect(await pending).toEqual(query ? { error: "access_denied" } : {});
    }
  });

  test("times out and stops idempotently without leaving a listening socket", async () => {
    const server = await callback({ timeoutMs: 15 });
    await expect(server.waitForCallback()).rejects.toThrow(
      "OAuth callback timeout after 15ms",
    );
    server.stop();
    server.stop();
    await expect(fetch(server.getCallbackUrl())).rejects.toThrow();
  });

  test("rejects an occupied port without disturbing its listener", async () => {
    const port = await freePort();
    const occupied = createServer();
    await new Promise<void>((resolve) =>
      occupied.listen(port, "127.0.0.1", resolve),
    );
    try {
      const server = new OAuthCallbackServer({ port, timeoutMs: 1000 });
      servers.push(server);
      await expect(server.waitForCallback()).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
      expect(occupied.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  test("uses the documented callback defaults", () => {
    const server = new OAuthCallbackServer();
    expect(server.getCallbackUrl()).toBe("http://127.0.0.1:8089/callback");
    server.stop();
  });
});
