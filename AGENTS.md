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
- Report installation as healthy only when a complete hook contract references every required event and both generated runtime scripts, runtime config, and private key exist as physical files.
- Model stable, legacy, and early-access hook generations as explicit contracts. Keep their activation requirements visible in CLI output and README guidance.
- Resolve Codex user hooks through `CODEX_HOME/hooks.json` with `~/.codex/hooks.json` as the default, matching Codex's existing-directory canonicalization rule. Preserve user TOML, project, plugin, and managed hook sources because Codex composes them additively. Register exact `PreToolUse` and `PostToolUse` matcher groups with ten-second command handlers, preserve the complete native payload, propagate freeze and revocation through exit code `2`, and keep guard lookup and audit delivery fail-open with observable errors. Commit Codex's user hooks, guard, audit runtime, runtime config, and private key through one rollback-capable transaction. Use `/hooks` to approve both definition hashes after installation.
- Resolve stable Kimi hooks through `$KIMI_CODE_HOME/config.toml` with `~/.kimi-code/config.toml` as the default, and treat an empty override as the default. Activate `~/.kimi/config.toml` only when the legacy home exists. Register exact `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` rules with ten-second commands; stable Kimi supports its current sixteen-event schema and legacy kimi-cli supports its thirteen-event schema. Preserve the native snake_case payload, propagate exit code `2`, and keep audit delivery fail-open with owner-only error logs. Use encoded PowerShell commands on Windows and exact two-argument shell commands on Unix. Commit every detected config, generated runtime, runtime config, and private key through one rollback-capable transaction.
- Resolve Grok Build user hooks through `$GROK_HOME/hooks/*.json` with `~/.grok/hooks/*.json` as the default, and treat an empty override as the default. Keep Claude Code, Cursor, project `.grok/hooks`, plugin, and `hooks-paths` sources read-only. Register exact `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` groups with ten-second command handlers, preserve the complete native camelCase payload, and emit Grok's documented deny JSON plus exit code `2` for frozen or revoked agents. Use encoded PowerShell commands on Windows and exact two-argument shell commands on Unix. Commit Grok's hook file, generated runtimes, runtime config, and private key through one rollback-capable transaction.
- Resolve Claude Code user hooks through `$CLAUDE_CONFIG_DIR/settings.json` with `~/.claude/settings.json` when the variable is absent. Match Claude Code's path resolution exactly: relative and empty values resolve from the current working directory, and literal tildes remain path segments. Keep project, local, managed, plugin, skill, and agent hook sources read-only. Validate the complete shipped handler schema, including command exec form, async rewake metadata, HTTP, MCP tool, prompt, and agent handlers. Register exact matchless `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` groups with ten-second exec-form command handlers. Preserve the complete native snake_case payload and propagate freeze and revocation through exit code `2`. Commit Claude Code's user settings, generated runtimes, runtime config, and private key through one rollback-capable transaction. Reject installation while the user source sets `disableAllHooks`, then require `/hooks` and `claude doctor` verification for higher-scope policy effects.
- Resolve Gemini CLI user hooks through `$GEMINI_CLI_HOME/.gemini/settings.json` with `~/.gemini/settings.json` when the variable is absent or empty. Preserve relative and literal-tilde home values as Gemini CLI does. Keep workspace, system defaults, system overrides, and extension hooks read-only. Preserve JSON comments while rejecting trailing commas and duplicate keys. Register exact matchless `BeforeTool` and `AfterTool` groups named `elydora-guard` and `elydora-audit` with ten-second command handlers. Preserve the complete native snake_case payload, emit valid JSON on exit code `0`, and propagate freeze and revocation through exit code `2`. Use encoded PowerShell commands on Windows. Commit Gemini CLI's user settings, generated runtimes, runtime config, and private key through one rollback-capable transaction. Respect `hooksConfig.enabled` and `hooksConfig.disabled`, then require `/hooks list` verification for higher-scope policy effects.
- Resolve Auggie user hooks through `~/.augment/settings.json`; keep system, workspace, local workspace, and alternate `--augment-cache-dir` settings read-only. Validate the shipped Auggie 0.33 hook schema: `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `Notification`, and `PromptSubmit`; regex matchers belong to tool events, command handlers use string-array arguments and positive millisecond timeouts, and metadata flags are booleans. Generate `.cmd` wrappers on Windows and `.sh` wrappers on Unix, preserve the complete native snake_case payload, and propagate freeze and revocation through exit code `2`. Commit Auggie settings, both wrappers, generated runtimes, runtime config, and private key through one rollback-capable transaction. Require exact runtime identity, canonical private keys, physical files, and exact wrapper sources during status checks, then verify the effective configuration with `auggie tools list`.
- Write Cline hooks only to `$CLINE_DIR/hooks` with `~/.cline/hooks` as the default; keep Documents and workspace hook roots read-only. Translate guard exit code `2` into Cline's JSON stdout cancellation control and preserve official hook input byte-for-byte.
- Write Cursor hooks only to `~/.cursor/hooks.json`; keep project and enterprise sources read-only. Register `preToolUse`, `postToolUse`, and `postToolUseFailure`, preserve the complete native payload plus `conversation_id`, and emit valid JSON on successful hook execution. Commit Cursor's config, guard, audit runtime, runtime config, and private key through one rollback-capable transaction. Set a ten-second timeout plus `failClosed` on every managed handler and propagate guard exit code `2` through the host shell.
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
- Read runtime config, private keys, status cache, chain state, and error logs through physical-file descriptors with identity checks. Write cache and validated chain state atomically, and append error logs through no-follow owner-only descriptors. Preserve rollback artifacts when recovery cannot safely restore an original file and include the recovery path in the surfaced error.
- Resolve every agent runtime directory as one physical child of `~/.elydora`; reject separators, traversal segments, cross-platform reserved names, symbolic-link directories, and linked identity configs before writes or recursive removal. Validate stored directory identity before changing host CLI configuration, and require an explicit agent ID when discovery is ambiguous.

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
