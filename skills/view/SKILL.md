---
name: view
description: Open the Context Doctor dashboard — a visual page of what feeds Claude Code's context in this project (health score, context stack, plugin weight vs real usage treemap, findings, hooks across the session lifecycle, competing owners, rule conflicts, searchable explorer). Use when the user wants to see, visualize or browse their Claude Code context.
user-invocable: true
argument-hint: "[--all-projects]"
---

Build and open the dashboard. This command only shows; it changes nothing.

## Steps

1. Count real usage for this project (reads local transcripts, ~1–3 s; it colors the treemap): `node "${CLAUDE_PLUGIN_ROOT}/scanner/scan.mjs" --usage $ARGUMENTS >/dev/null`
2. Scan and render: `node "${CLAUDE_PLUGIN_ROOT}/scanner/scan.mjs" --summary` (writes `~/.claude/context-doctor/report.html`).
3. Open it with the platform opener: `open` (macOS), `xdg-open` (Linux), `start ""` (Windows), e.g. `open ~/.claude/context-doctor/report.html`.
4. Reply in the user's language with at most five lines:
   - the health score and whether it is the automatic estimate or from `/context-doctor:audit` (the page says which)
   - the single biggest number (e.g. always-loaded tokens, or % of the skill listing that overflows)
   - the top P0 finding in one line
   - the path of the page, and that it is local only
   - next step: `/context-doctor:audit` for a verified score, or the fix command for the top finding

The page holds paths, MCP hosts and secret *key names* (never values). Keep it local; if the user wants to share it, offer to publish a copy as a private artifact and say what it contains first.
