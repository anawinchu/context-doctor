# Changelog

## 1.1.0 — 2026-10-24

Fixes
- `--set-plugin` (and the pane's plugin toggles) now write `.claude/settings.local.json` instead of the checked-in `.claude/settings.json`, back the file up, refuse odd plugin ids, and warn when the local file isn't gitignored.
- State is kept per project (`projects/<project>/report.json`, `usage.json`, `audit.json`): scanning another project no longer erases this one's diff, usage or audit score. 1.0 state files are still read once.
- Secret values never reach reports: hook commands, MCP args/URLs and memory lines are redacted. New CL-10 checks for hook commands, settings `env`, and credential-looking lines in always-loaded memory.
- The listing budget is ≈1% of the context window (from `model`, or `contextWindow` in config.json) instead of a fixed 10k, so 200k-context setups get correct CL-02 findings and budget scores.
- `.claude/rules/**/*.md` with `paths` frontmatter are counted as path-scoped, not always loaded; rules in subfolders are found.

Better data
- `--usage` parses transcripts as JSON (no longer tied to key order) and adds MCP calls per server, hook run time / timeouts / errors, and denied tool calls; it reads Claude Code's lifetime `skillUsage` / `pluginUsage` counters and marks plugins with no usage signal (themes, styles) or counter-only signal (LSP).
- New findings: idle MCP servers (framed as decluttering, since schemas are deferred), slow hooks (CL-18), many denied tool calls, broken skill/agent frontmatter, agents that never load or collide (CL-17), personal memory that repeats a checked-in file.
- claude.ai connectors are listed from `~/.claude.json`; the side pane saves the composed system prompt at session start so MCP and connector instructions are scanned for conflicts.

Skills
- `distill`: trims checked-in CLAUDE.md content a session can derive from the repo; uses local settings; MCP and no-signal plugin guidance.
- `harmonize`: checks personal-vs-checked-in duplicates and records ruled-out conflicts with `--dismiss`.
- `audit`: per-project `audit.json`; states what built-in `/doctor` covers and hands those issues over.
- `secure`, `annotate`, `sharpen`: use the new secret, hook-timing, denial and frontmatter data.

Other
- The dashboard makes no network requests (system fonts only).
- GitHub Actions CI runs the scanner tests on Node 18/20/22.

## 1.0.0 — 2026-10-23

First public release.

- Skills: view, audit, distill, sharpen, harmonize, annotate, secure, trace, plus the shared context-doctor reference (anti-patterns CL-01…CL-16).
- Bundled scanner (`scanner/scan.mjs`): memory chain with @imports, skills/commands/agents from user, project, plugins and claude.ai sync; hooks; MCP servers; rule extraction; competing owners; rule-conflict candidates; real usage from transcripts; diff between scans; English and Thai output.
- Dashboard (`report.html`): health score, context stack, usage treemap, findings, hook lifecycle, owners, conflicts, explorer; light/dark.
- Side pane (function hooks): summary, real system prompt, live events, usage, diff, per-project plugin toggles.
