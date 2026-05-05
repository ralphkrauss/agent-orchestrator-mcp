# Plan Index

Branch: `31-codex-worker-bash-sandbox-blocks-outbound-http-eg-apigithubcom-breaking-gh-api-in-workflows`
Updated: 2026-05-05

## Sub-Plans

| Plan | Scope | Status | File |
|---|---|---|---|
| Codex worker network egress under daemon-managed sandbox | Decouple `--ignore-user-config` from `service_tier`, add an explicit, opt-in profile-level network surface (`codex_network`) for the codex backend across the full profile round-trip (schema, MCP upsert/list, observability, supervisor system-prompt formatters, docs). **Human decisions locked 2026-05-05: OD1 = B (uniform `'isolated'` default; breaking change with documented migration); OD2 = B (direct-mode-only `start_run`/`send_followup` override).** | planning (decisions locked; ready for final reviewer sign-off) | plans/31-codex-network-egress.md |
