# Janus release migration

The original `Publish to npm` workflow still runs on `v*` tag pushes and keeps
the noncanceling `npm-publish` concurrency group and protected `npm-publish`
environment. With `JANUS_MCP_RELEASE_MODE` unset, it uses the existing release
steps in their original order.

Two hosted modes are prepared but are not commissioned:

| Mode | Verification | Final npm operation |
| --- | --- | --- |
| unset | Existing self-hosted workflow | Existing publication |
| `verify` | Authenticate the protected Janus producer and coverage | Offline dry run |
| `publish` | Authenticate the same protected evidence | Minimal GitHub-hosted OIDC publisher |

An unknown mode fails explicitly. Never select either hosted mode until the
commissioning gates below pass, and never create a tag/package/release solely
to test migration.

## Hosted path

`Verify Janus package` runs on an ephemeral GitHub-hosted Linux runner. It checks
out the exact tag source for Codecov's source mapping, without installing or
executing project lifecycle scripts. Independently pinned Devops helpers
authenticate the original workflow, tag, source, newest Buildkite job and
protected artifacts.

Only the authenticated LCOV file is supplied to Codecov, with automatic report
search disabled and the original commit explicit. Existing nonfatal Codecov
upload-error behavior is preserved. When measurement succeeded but a later
producer phase failed, measured coverage is uploaded before the workflow
propagates that failure. Failed measurement skips upload. Invalid evidence
fails without upload. No failure can authorize a package handoff.

The verifier retrieves a distinct coverage-only envelope while Janus is still
running. After Codecov returns, it acknowledges the authenticated native build,
job and envelope hash. Janus checks that acknowledgement before starting lint,
typecheck and packaging, and keeps monitoring it during those phases. The
handoff then waits for successful final evidence and requires the same source,
producer, early artifact identity and measured report hashes. Coverage retrieval
and this wait share one 350-minute verifier budget.

The dependent
`Publish to npm` job checks out only the pinned Devops helpers. It installs
Node 24.22.0 with bundled npm 11.19.1, reauthenticates the handoff and native
producer, and publishes only the verified tarball with lifecycle execution
disabled. Publisher-only retries retain their original authenticated handoff.
The helper never automatically retries an npm publication.

The workflow needs a read-only `JANUS_HELPERS_READ_TOKEN` for the private Devops
checkout and pipeline-scoped `BUILDKITE_MCP_RELEASE_READ_TOKEN` for native
evidence. Janus separately needs the protected Actions-read credential
`github-mcp-squared-actions-token`; it is never exposed to project execution.
GitHub's token has contents/actions read access during verification;
OIDC permission is confined to the publisher. `CODECOV_TOKEN` belongs only to
the coverage-upload step. Reader credentials are removed from the helper
process environment before npm runs. Private job state is removed after
success or failure.

## Gates before cutover

- Commission the native webhook/pipeline and matching producer image/policy,
  including exact source identity, job graph, artifact hashes/storage,
  required status, retries, cancellation and rollback.
- Verify the coordinated early handoff with native artifact transport and
  GitHub's expanded acknowledgement step names. Prove cancellation before,
  during and after acknowledgement, plus retry behavior. Local provider
  fixtures do not prove Codecov transfer or native API visibility.
- Prove the effective total workflow budget, including both jobs, queueing and
  environment approval. Individual 360-minute job limits and a bounded read
  loop do not establish parity with the original single job.
- Verify real Codecov transfer, native GitHub/Buildkite event ordering and the
  original workflow/environment's npm trusted-publisher configuration.
  Offline fixtures do not establish OIDC exchange or provenance.
- Resolve the separately tracked Bun 1.3.5 monitor-fixture crash before
  commissioning; successful subsequent runs are not a root-cause fix.

The full fleet and provider-access blockers remain tracked in the infra plan.
This workflow change does not enable the route, alter credentials or publish
a package.
