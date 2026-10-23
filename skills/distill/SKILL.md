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
| per plugin: used / total, unused listing tokens | `--usage` table |

## 2. Propose (change table)

For each candidate, one row: **target · action · evidence · token delta · risk**.

Candidates, in this order:
1. **Plugins with ~0 usage** in this project → `enabledPlugins: { "<id>": false }` in `<project>/.claude/settings.json`. Evidence: `--usage` row. If 1–3 of its skills *were* used, propose copying those skill folders into `<project>/.claude/skills/` (from `report.items[].file`) before disabling.
2. **Individual skills** never used, from plugins that stay → `skillOverrides: { "<name>": "off" }`.
3. **User-level @imports** of domain manuals (CL-01) → remove the `@file` line; confirm a skill already covers it, or create a small skill that loads it on demand.
4. **Memory bloat** — MEMORY.md lines that are paragraphs instead of one-line pointers; CLAUDE.md sections duplicated in specs/docs. Propose concrete rewrites (show before/after, tokens).
5. **Language cost** (CL-14) only if the user agrees: model-only lines rewritten tersely.

Never propose disabling: the project's own skills/agents, anything used in the last 30 days, anything the user named as important.

## 3. Confirm

Show the table and the projected numbers (always-loaded before → after, listing before → after, entries regaining descriptions). Ask with AskUserQuestion: apply all / choose rows / cancel. Multi-select for rows when there are more than four.

## 4. Apply

- Back up every settings/memory file first: `cp f f.bak-$(date +%Y%m%d%H%M%S)`.
- Plugin toggles: `node "${CLAUDE_PLUGIN_ROOT}/scanner/scan.mjs" --set-plugin <id> off` (writes project settings) — or edit JSON directly for `skillOverrides`.
- Edit memory with Edit, not sed.

## 5. Re-measure

Re-run `--summary`; report before → after for every metric. Remind: plugin/settings changes take effect in the **next** session (`/clear` is not enough for plugins). Suggest `/context-doctor:audit` to re-score.

**NEVER** edit `~/.claude/plugins/cache/**`, delete files (disable instead), or apply without confirmation.
