import "./preload.mjs";
import { afterAll } from "bun:test";

// Bun 1.3.5 does not emit process exit events after its test runner finishes.
afterAll(() => globalThis.__mcpCoverageSnapshot("afterAll"));
