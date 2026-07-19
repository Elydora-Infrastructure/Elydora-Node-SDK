# Elydora Node SDK Engineering Contract

## Scope

This repository owns the published `@elydora/sdk` package, its `elydora` CLI, local signing behavior, API client, generated hook runtime, and Node-specific agent adapters.

## Integration Sources

- Verify every agent hook contract against current official provider documentation before changing an adapter.
- Treat `../Elydora-Open-Source/integrations/catalog.json` as the cross-product provider inventory.
- Keep the exported `INTEGRATION_TYPES` tuple aligned with that inventory, and require `integration_type` in every agent registration request.
- Keep adapter delivery claims aligned with executable tests in this repository.
- Synchronize completed provider behavior into the Python SDK, Go SDK, Open Source distribution, Console, Docs, and landing page through separate reviewed commits.

## Hook Adapter Invariants

- Preserve unrelated user configuration and remove only Elydora-owned entries.
- Parse every affected user configuration before the first write.
- Surface malformed or unreadable configuration with contextual errors and leave the original file intact.
- Write configuration through a same-directory temporary file followed by an atomic rename.
- Quote the current Node executable and generated script paths for the host shell.
- Forward official hook JSON from STDIN without reshaping provider fields.
- Use the provider's documented blocking mechanism. Command-hook providers that define exit code `2` must receive exit code `2` from the freeze guard.
- Report installation as healthy only when a complete hook contract references both generated runtime scripts and both scripts exist.
- Model stable, legacy, and early-access hook generations as explicit contracts. Keep their activation requirements visible in CLI output and README guidance.
- Keep Grok Build writes inside its native global `$GROK_HOME/hooks/*.json` contract. Treat Claude Code and Cursor compatibility files plus project `.grok/hooks` as read-only integration sources.
- Write Auggie hooks only to `~/.augment/settings.json`; keep system and workspace settings read-only. Generate `.cmd` wrappers on Windows and `.sh` wrappers on Unix because Auggie dispatches supported script paths, and express hook timeouts in milliseconds.
- Write Cline hooks only to `$CLINE_DIR/hooks` with `~/.cline/hooks` as the default; keep Documents and workspace hook roots read-only. Translate guard exit code `2` into Cline's JSON stdout cancellation control and preserve official hook input byte-for-byte.
- Preserve Factory Droid's scope-root `hooks.json` precedence, legacy nested hook source, and per-event `settings.json` fallback. Scope-root and legacy files store event keys at the document root; settings stores the same map under `hooks`. Edit only effective user sources; keep project and organization sources read-only. Preserve JSONC comments through syntax-tree edits and require `/hooks` review after external changes.
- Resolve Qwen Code user settings through explicit `QWEN_HOME`, then user-level `.qwen/.env`, then `~/.env`, with `~/.qwen/settings.json` as the default. Keep workspace settings read-only. Preserve JSON comments, reject trailing commas and duplicate keys before writes, express timeouts in milliseconds, propagate native exit code `2` through PowerShell, and require `/hooks` review.

## Code Quality

- Keep production source files at or below 500 lines.
- Keep functions focused on one ownership boundary.
- Propagate unexpected errors to the CLI boundary.
- Use documented defaults only for genuinely optional configuration.
- Avoid compatibility shims without a named public or user configuration contract.
- Keep private keys and API tokens out of process arguments and generated setup commands. Accept them through hidden terminal input or owner-only credential files.
- Persist credential-bearing files through owner-only same-directory temporary files and atomic rename.

## Verification

Run the focused adapter test during development, then execute all release gates before commit:

```powershell
npm run build
node --test test/<provider>-plugin.test.mjs
npm test
npm audit --omit=dev --audit-level=high
npm pack --dry-run --json
git diff --check
```

Provider adapter tests must cover installation, idempotency, official event forwarding, blocking behavior, status, missing runtime files, uninstall ownership, and malformed configuration preservation.

Commit and push one root issue before starting the next one.
