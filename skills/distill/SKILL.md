---
name: distill
description: Cut Claude Code context weight for this project — disable plugins and skills that transcripts show are unused, shrink always-loaded memory, move domain manuals out of @imports into skills. Use when context feels heavy, skills lose their descriptions, or the user wants fewer skills/plugins.
user-invocable: true
argument-hint: "[target: plugins | memory | all]"
---

## MANDATORY PREPARATION

Invoke `/context-doctor:context-doctor` and run its Context Gathering Protocol. Then also run `node "${CLAUDE_PLUGIN_ROOT}/scanner/scan.mjs" --usage` (add `--all-projects` if the user wants a global view) and `--plugins`.

---

Goal: the smallest setup that still covers what this project actually does. Measure, propose, confirm, apply, re-measure.

## 1. Measure

| Metric | Source |
|---|---|
| always-loaded tokens, per file | `report.memory[]` |
| listing tokens if all descriptions shown | `stats.listingTokensIfFull` |
| entries that arrived as bare names | count in your own skill listing |
| listing budget (≈1% of context window) | `report.listingBudget`, `contextWindowFrom` |
| per plugin: used / total, lifetime uses, unused listing tokens | `--usage` table |
| MCP servers never called in the window | `--usage` "MCP servers" |

## 2. Propose (change table)

For each candidate, one row: **target · action · evidence · token delta · risk**.

Candidates, in this order:
1. **Plugins with ~0 usage** in this project → `enabledPlugins: { "<id>": false }` in `<project>/.claude/settings.local.json` (personal; it overrides user and project settings, and never reaches the team). Use the checked-in `.claude/settings.json` only if the person says it is a team decision. Evidence: `--usage` row — window use from transcripts; the lifetime column is Claude Code's own counter since install across all projects (a plugin's counter is seeded at install, so only a count above 0 means anything). Rows marked "no usage signal" (themes, output styles, monitors) cannot be judged from data: recommend removal and ask "do you use <name>?". If 1–3 of its skills *were* used, propose copying those skill folders into `<project>/.claude/skills/` (from `report.items[].file`) before disabling.
   **MCP servers never called** → `/mcp disable <name>` (per project, reversible; never `claude mcp remove`, which deletes the config and its tokens). Their tool schemas are usually deferred, so frame this as one less connection to maintain, not token savings.
2. **Individual skills** never used, from plugins that stay → `skillOverrides: { "<name>": "off" }`.
3. **User-level @imports** of domain manuals (CL-01) → remove the `@file` line; confirm a skill already covers it, or create a small skill that loads it on demand.
4. **Memory bloat** — MEMORY.md lines that are paragraphs instead of one-line pointers; CLAUDE.md sections duplicated in specs/docs. Propose concrete rewrites (show before/after, tokens).
5. **Derivable content in checked-in CLAUDE.md** — keep only what a session cannot work out by reading the repo. Candidates to cut: directory/file listings, the tech stack (package.json says it), standard commands that the package scripts already name (`npm run dev`, `npm test`), restatements of linter/formatter config, generic advice ("write clean code"). Keep: invariants and gotchas, non-obvious commands or flags, things that broke before, policy (deploy/push/customer data), pointers to where the truth lives. For each cut, quote the line and name the file that already says it. Multi-step procedures that survive (e.g. local DB setup) → move into a project skill or a `.claude/rules/*.md` file with `paths` so they load only when relevant. Checked-in edits stay in the working tree for the person to review in `git diff` — never commit them.
6. **Language cost** (CL-14) only if the user agrees: model-only lines rewritten tersely.

Never propose disabling: the project's own skills/agents, anything used in the last 30 days, anything the user named as important.

## 3. Confirm

Show the table and the projected numbers (always-loaded before → after, listing before → after, entries regaining descriptions). Ask with AskUserQuestion: apply all / choose rows / cancel. Multi-select for rows when there are more than four.

## 4. Apply

- Back up every settings/memory file first: `cp f f.bak-$(date +%Y%m%d%H%M%S)`.
- Plugin toggles: `node "${CLAUDE_PLUGIN_ROOT}/scanner/scan.mjs" --set-plugin <id> off` (writes `.claude/settings.local.json`, backs it up, warns if it is not gitignored) — or edit JSON directly for `skillOverrides`.
- Edit memory with Edit, not sed.

## 5. Re-measure

Re-run `--summary`; report before → after for every metric. Remind: plugin/settings changes take effect in the **next** session (`/clear` is not enough for plugins). Suggest `/context-doctor:audit` to re-score.

**NEVER** edit `~/.claude/plugins/cache/**`, delete files (disable instead), or apply without confirmation.
