---
name: annotate
description: Make hidden Claude Code behavior visible to the model — document hooks that rewrite commands, compress output, inject reminders, format files or deny edits, and MCP instructions in force, in a short Environment notes section. Use when tool results look odd, edits get blocked unexpectedly, or the user wants Claude to know about their hooks.
user-invocable: true
argument-hint: "[hook id or event]"
---

## MANDATORY PREPARATION

Invoke `/context-doctor:context-doctor` and run its Context Gathering Protocol. Pull `report.hooks`. If the live pane has data, `/context-doctor-live` shows hook injections and denies observed this session.

---

## 1. Classify every hook

| class | examples | does the model need to know? |
|---|---|---|
| rewrites input | `rtk hook`, command dispatchers | **yes** — results differ from the command it wrote |
| filters/compresses output | rtk | **yes** — must know how to get raw output |
| denies / gates | config-protection, gateguard | **yes** — so it doesn't retry blindly |
| injects text | SessionStart summaries, cost warnings, compact suggestions | **yes** — so it treats them as data |
| modifies files after the turn | format-on-stop | **yes** — diffs include lines it didn't write |
| telemetry / notifications only | office hooks, status lines, cost trackers | no — list only in the report |

Read the hook's script (path in `command`) when the description is unclear, to confirm what it actually does.

## 2. Draft "Environment notes"

One compact section for the right file: user `~/.claude/CLAUDE.md` for user-level hooks, project CLAUDE.md for project/plugin hooks. One line each, behavior + what to do:

```
## Environment notes (hooks)
- Bash runs through rtk: output of grep/head/cat may be summarized → rerun with `rtk proxy <cmd>` when it looks incomplete.
- Stop hook formats edited JS/TS (prettier/biome) → expect formatting-only diff lines.
- Edits to linter/formatter configs are denied by a hook → ask the user instead of retrying.
```

Also list MCP server instructions that are in force and whether the project overrides them.

## 3. Offer the alternative

For each "yes" hook, also offer: disable it (setting/userConfig) instead of documenting. Fewer hooks beats more notes.

## 4. Confirm → apply

Show draft + token cost (keep the section under ~150 tokens). AskUserQuestion, back up, Edit.

**NEVER** paste hook source or long descriptions into memory — one line each.
