# Janus ordinary CI

With `JANUS_MCP_CI_MODE=janus`, eligible same-repository pull requests targeting
`main` and pushes to `main` run the test and coverage job and the standalone
compilation job on Janus. Fork pull requests and other modes retain hosted checks.
The hosted coverage workflow verifies the matching Buildkite result before
delivering coverage.

The runner and the `JANUS_MCP_CI_POLICY` repository variable must describe the
same producer policy. Verify both the native checks and hosted coverage for the
exact source commit after changing that pair.

This document changes no application, workflow, credentials, or release behavior.
