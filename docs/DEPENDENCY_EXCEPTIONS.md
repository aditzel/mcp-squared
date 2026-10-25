# Dependency Exceptions

Temporary risk acceptances for unresolved advisories.

The former OpenTUI → Jimp → file-type exception was resolved by pinning
`@opentui/core` to `0.2.1`, which removes Jimp and its Zod 3 dependency chain.
Configuration and monitor rendering remain lazy-loaded and covered by the real
terminal renderer fixtures. Existing audit-ignore identifiers are unchanged.

| Advisory | Package(s) | Severity | Rationale | Controls | Owner | Review By | Linked Issue |
|---|---|---|---|---|---|---|---|
| `protobufjs` multiple CVEs (`<=7.5.5`) | `@huggingface/transformers -> onnxruntime-web -> protobufjs` | Critical/High | Transitive dependency via @huggingface/transformers for local embeddings. protobufjs is used by onnxruntime-web for model loading, not exposed to network input. MCP² only loads local BGE-small models; no untrusted protobuf payloads reach this code path. | Embeddings are optional (`operations.embeddings.enabled = false` by default); keep embeddings disabled in untrusted environments; reassess on @huggingface/transformers bump. | Maintainers | 2026-07-01 | Pending |
| `hono` multiple CVEs (`<4.12.18`) | `hono`, `@hono/node-server` | Moderate | Hono is used for the local MCP HTTP server and OAuth callback. Vulnerabilities affect JSX SSR, cookie helpers, JWT middleware, and serveStatic — none of which are used by MCP². MCP² only uses Hono for route handling and request/response passing. | Keep Hono updated; reassess on each bump; do not add JSX/cookie/JWT features without reviewing exceptions. | Maintainers | 2026-07-01 | Pending |
| `fast-uri` host confusion/path traversal (`<=3.1.1`) | `@modelcontextprotocol/sdk -> ajv -> fast-uri` | High | Transitive via MCP SDK's ajv validation. fast-uri is used for URL parsing in validation schemas, not for network requests. MCP² validates config URLs server-side; no untrusted URI parsing reaches this path. | Reassess on @modelcontextprotocol/sdk bump. | Maintainers | 2026-07-01 | Pending |
| `yaml` stack overflow (`>=2.0.0 <2.8.3`) | `yaml` (direct) | Moderate | YAML is used for config file parsing. Vulnerability requires deeply nested YAML collections (thousands of levels). MCP² config files are authored by users, not untrusted input. | Updated to yaml@2.9.0; recheck on next advisory. | Maintainers | 2026-07-01 | Fixed in 2.9.0 |
| `qs` DoS (`>=6.11.1 <=6.15.1`) | `@modelcontextprotocol/sdk -> express -> body-parser -> qs` | Moderate | Transitive via MCP SDK's express usage. qs is used for URL query parsing; MCP² does not expose express directly to untrusted input. | Reassess on @modelcontextprotocol/sdk bump. | Maintainers | 2026-07-01 | Pending |
| `ip-address` XSS (`<=10.1.0`) | `@modelcontextprotocol/sdk -> express-rate-limit -> ip-address` | Moderate | Transitive via express-rate-limit. XSS requires crafting IPv6 addresses for HTML emission; MCP² does not render IP addresses as HTML. | Reassess on @modelcontextprotocol/sdk bump. | Maintainers | 2026-07-01 | Pending |
| `path-to-regexp` ReDoS (`>=8.0.0 <8.4.0`) | `@modelcontextprotocol/sdk -> express -> router -> path-to-regexp` | High/Moderate | Transitive via MCP SDK's express router. ReDoS requires crafted route patterns; MCP² defines fixed routes, not user-supplied patterns. | Reassess on @modelcontextprotocol/sdk bump. | Maintainers | 2026-07-01 | Pending |
