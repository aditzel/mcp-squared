# Shadow Linux CI

This is preparation for the protected `mcp-squared-ci` Buildkite pipeline.
Existing GitHub workflows remain authoritative. The tag publisher now uses the
same measured branch-coverage command as the ordinary test workflow.
The shadow jobs must not replace required checks or imply that Codecov, publishing,
or the native macOS/Windows jobs have migrated.

Use bootstrap command `janus-ci bootstrap` and queue `janus-linux`. The image-owned
manifest selects Node `24`, Bun `1.3.5`, and these independent jobs:

| Job | Approved command | Timeout |
| --- | --- | --- |
| `shadow-test-and-coverage` | `["bash", "scripts/buildkite/check.sh", "shadow-test-and-coverage"]` | 360 minutes |
| `shadow-standalone-compile` | `["bash", "scripts/buildkite/check.sh", "shadow-standalone-compile"]` | 360 minutes |

Both jobs use empty environment allowlists and artifact lists. Repository scripts
receive no provider credentials. Configure main pushes and pull requests targeting
main; the protected controller currently accepts same-repository PRs only.

The coverage shadow preserves frozen install, dependency audit, `bun run test:coverage`,
the combined-output coverage log, measured line/branch threshold enforcement,
strict routing evaluation, lint, and typecheck. It uses the same instrumentation
and child-process coverage collection as GitHub Actions, including rejection of
missing branch data. It prints an explicit pending notice at the Codecov stage. Required
authenticated Codecov upload remains in GitHub Actions until a reviewed handoff
implements it; local success is only evidence for the credential-free stages.
Coverage thresholds and existing audit exceptions are unchanged.

The Linux compile shadow preserves the original target list:
`bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-windows-x64`.
It also preserves `STRICT_INFRA_FAILURES=0`: product failures fail, while classified
infrastructure-only failures remain non-blocking. Existing native-runtime probes,
size limits, and embedding-runtime warning behavior remain in `compile-matrix.sh`.
A successful exit must be read alongside its product/infra/warning summary.

Remaining parity gates include restricted Linux execution, authenticated Codecov
delivery, GitHub status mapping, provider concurrency/cancellation behavior, fork
PR handling, and publishing authorization. Native macOS/Windows smoke and native
compile runs remain on their original runners; Linux cross-compilation cannot
prove those platforms' runtime behavior. Publish routing and Junie remain unchanged.

## Validation and commissioning

The dependency and measured-coverage baseline was repaired in PR #28. This
preparation builds on that baseline; it does not restore Bun's unmeasured branch
coverage fallback. Wrapper tests check the command order, combined stdout/stderr
capture, failure propagation through the coverage pipe, exact Bun pin, Node major,
compile targets, and the existing infrastructure-failure policy.

Passing wrapper tests or local containers does not commission a Buildkite
pipeline. Required GitHub checks remain authoritative until the protected
manifest, provider configuration, live PR/main execution, cancellation, artifacts,
and authenticated Codecov handoff have all been verified. Do not change required
checks on the strength of this preparation alone.

## Tag release preparation

The following credential-free project stages prepare the remaining Linux work
from `.github/workflows/publish.yml`. They require Node 24 and Bun 1.3.5:

```sh
bash scripts/buildkite/release.sh check
bash scripts/buildkite/release.sh pack v0.8.1
```

`check` reuses the measured coverage shadow: frozen install, audit, measured tests,
80% line and branch thresholds, strict routing evaluation, lint, and typecheck.
It explicitly leaves authenticated Codecov delivery pending. The retained GitHub
tag workflow uses that measured test command too; raw `bun test --coverage` does
not supply the branch measurements required by the repaired coverage gate.

`pack` requires the tag to exactly match `package.json`, performs its own frozen
install for a fresh build job, and runs `bun pm pack`. Bun's
[pack lifecycle](https://bun.sh/docs/pm/cli/pm#pack) runs the existing `prepack`
build and runtime-import verification and respects the package file whitelist.
Any `prepublishOnly` hook also runs before packing; future `publish` or
`postpublish` hooks require an explicit publisher design. No registry publication
occurs. The result is `build/npm-release/package.tgz` with a local size/hash
report in `package.json`. Existing output is never overwritten, failed packaging
leaves no result, and package/lockfile changes fail the stage.

These files and their report are untrusted repository output. Before publication,
the protected controller must authenticate the tag/source and successful check
dependency, stop repository processes, inspect the tarball members and package
identity, and snapshot the exact files into its own authenticated envelope.
Native Buildkite tag/attempt/status/cancellation/timeout behavior, Codecov
delivery, the hosted handoff, and the minimal supported registry publisher are
still required. Neither this script nor a successful local container establishes
those facts. Do not admit a release route or enable publication from this
preparation alone.

Preserve the original `v*` event, `npm-publish` environment and concurrency group
with `cancel-in-progress: false`, 360-minute workflow budget, package lifecycle,
and supported trusted-publication identity when wiring the final workflow.
Retain native macOS/Windows CI separately. The existing publisher remains the
authority until the full replacement and rollback have been commissioned; no
test package, tag, release commit, or GitHub release is needed for this work.

## Ordinary CI hosted handoff

The Test and Coverage workflow now contains an **inactive** protected handoff.
`JANUS_MCP_CI_MODE` unset keeps the existing hosted Linux jobs. After commissioning,
`janus` selects `Verify Janus ordinary coverage` for main pushes and same-repository
PRs targeting main. Fork PRs retain hosted Linux checks and never receive the
helper or Buildkite reader credentials. Unknown nonempty modes fail explicitly.
Native macOS/Windows smoke and native compile entries remain unchanged. The
original global `test-and-coverage` cancellation group remains literal and keeps
`cancel-in-progress: true` across refs.

The hosted verifier checks out source for coverage path mapping but executes no
repository code. It runs only the DevOps helpers pinned at
`64359071ec584e884d364f6be052ae2d01b30231`, then:

1. Discovers and pins the native Buildkite build for the authenticated workflow
   source. Its exact policy, pipeline UUID, GitHub run/attempt, frozen PR merge
   parents and current producer attempts must match.
2. Retrieves the two protected measurement reports and their index. It uploads
   only the verified LCOV to Codecov, explicitly using the authenticated head,
   branch and PR identity, then acknowledges that exact measurement.
3. Waits for both independent Linux jobs and the entire build to pass. Janus
   performs lint/typecheck after the acknowledged upload. A later failure keeps
   measured coverage but fails the hosted result. A retry or replacement cannot
   reuse the old acknowledgement.

The Codecov action preserves `fail_ci_if_error: false`; a successful upload step
is not proof of backend ingestion. Its plugins are disabled because only the
verified LCOV is needed. The action persists `CC_TOKEN`, so subsequent helper
steps explicitly clear it. Reader tokens are limited to the two Python steps;
no repository command receives them. No npm publishing or deployment authority
is part of ordinary CI.

The wrapper shares one 350-minute deadline across discovery, coverage and final
verification, within the existing 360-minute hosted-job ceiling. Queueing and
upload time consume this budget; final verification cannot reset it. This keeps
the inherited maximum, rather than making tests wait six hours by design. The
prepared producer retains its separate 360-minute command ceiling plus bounded
finalization. Any timeout is failure, not successful skip.

### Commissioning and rollback

Keep the mode unset until all of these are ready:

- Review and land the matching producer/reader/gate/helper stack and this source
  workflow. The pinned [DevOps operations guide](https://github.com/MiraiForge/devops/blob/64359071ec584e884d364f6be052ae2d01b30231/runbooks/buildkite-mcp-ordinary-coverage.md)
  describes exact image, source and transport validation.
- Add the ordinary coverage policy narrowly to the deployed fleet manifest;
  preserve unrelated profiles and retain the previous matching image, manifest,
  Compose and pipeline configuration. Do not deploy the one-project example over
  the whole fleet. Use fresh builds after an image/policy change.
- Configure `JANUS_MCP_CI_POLICY` as trusted JSON with exactly `schemaVersion: 1`,
  `repository: "aditzel/mcp-squared"`, `pipeline: "mcp-squared-ci"`, the observed
  nonzero `pipelineId`, and reviewed `producerPolicySha256`. Never obtain the
  expected digest from unreviewed artifacts merely to make them pass.
- Provision approved `BUILDKITE_MCP_CI_READ_TOKEN` for this pipeline's builds and
  artifacts, `JANUS_HELPERS_READ_TOKEN` for the pinned DevOps checkout, and the
  protected Janus `github-mcp-squared-actions-token` for repository Actions reads.
  GitHub supplies its job-scoped Actions/Contents reader; the existing Codecov
  token remains in the hosted upload. This change provisions none of them.
- Prove real main/PR delivery, exact report attribution, upload-before-lint,
  compile/lint failures, cancellation, retries, stale-attempt rejection and
  continued native-platform execution. Required-check mapping must account for
  the replacement verifier before removing old hosted Linux check requirements.

To roll back, unset `JANUS_MCP_CI_MODE`, cancel/drain affected builds, and restore
that saved matching runner/pipeline set. Launch fresh hosted runs and verify
Linux plus native checks before treating recovery as complete. A GitHub rerun
cannot replay an older Janus measurement; recreate matching evidence instead.
The separate tag release workflow and its mode remain independent.
