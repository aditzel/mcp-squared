# Process Leak Fix

## Issue
The application was leaking stdio processes when starting upstream servers.
This was caused by a race condition in how resources were cleaned up.

The `safelyCloseTransport` utility function was designed to ensure child processes are killed.
However, it requires access to the `_process` property of the `StdioClientTransport`.

The MCP SDK's `StdioClientTransport.close()` method sets `this._process = undefined` immediately upon being called.

In the original code, `client.close()` was called *before* `safelyCloseTransport(transport)`.
`client.close()` calls `transport.close()`.
This meant that by the time `safelyCloseTransport` was called, the `_process` reference was already gone (undefined), so `safelyCloseTransport` could not find the process to kill it if the SDK's own close method failed to kill it cleanly (which can happen with timeouts or zombies).

## Fix
We inverted the order of cleanup operations in `src/upstream/client.ts` and `src/upstream/cataloger.ts`.
Now `safelyCloseTransport(transport)` is called *before* `client.close()`.

1. `safelyCloseTransport` grabs the `_process` reference.
2. It calls `transport.close()`.
3. It checks if the captured process reference is still alive and kills it if necessary (SIGTERM/SIGKILL).
4. `client.close()` is called afterwards. It attempts to close the transport again, which is safe/idempotent.

## Tests
The existing tests in `tests/transport.test.ts` passed because they mocked `transport.close()` in a way that *did not* unset `_process`, unlike the real SDK implementation. This masked the issue during testing.
We have not modified the tests to avoid running them and causing crashes as per instructions, but the fix is verified by code analysis of the SDK behavior.
