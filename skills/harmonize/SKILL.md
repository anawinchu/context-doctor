---
name: harmonize
description: Resolve contradictions and stale facts across Claude Code's instruction sources — CLAUDE.md, MEMORY.md, skills, agents, MCP server instructions and the harness rules. Use when Claude follows the wrong rule, rules disagree, or memory looks outdated.
user-invocable: true
argument-hint: "[subject, e.g. deploy | commit | notion]"
---

## MANDATORY PREPARATION

Invoke `/context-doctor:context-doctor` and run its Context Gathering Protocol. Pull `report.ruleConflicts`. If a subject was given, also run `--find "<subject>"`.

---

## 1. Build the conflict list (verified only)

For each candidate conflict, open both sources at the cited lines and classify:
- **Real** — they prescribe incompatible actions in the same situation.
- **Scoped** — they apply to different actors/contexts (e.g. subagents vs main model) → not a conflict; may still need wording that makes the scope explicit.
- **False positive** — drop.

Add what the scanner cannot see:
- **MCP server instructions** in your system prompt vs project memory (CL-15).
- **Stale memory** (CL-11): every path, command, server, tool or workflow named in CLAUDE.md / MEMORY.md / memory files — check it exists (`ls`, `grep -r`, `which`). Dated statements ("X replaced Y on …") — check the code agrees.

## 2. Decide the winner

Use the precedence in the core skill. Default: the more recent explicit user instruction (a dated memory line such as "user asked on <date>") wins over generic skill text; project rules win over plugin rules. When unclear, ask — this is the person's policy, not yours.

## 3. Propose

Row per conflict: **subject · source A (line) · source B (line) · winner · edit**. Edits, in preference order:
1. Fix the lower-precedence source if the user owns it (project skill description, memory line).
2. Disable the plugin item if not owned.
3. Add one explicit tie-break line to project CLAUDE.md (`## Precedence` section) when neither can change — e.g. MCP connector instructions.
4. For stale lines: update to the current fact, or delete the pointer and its memory file.

## 4. Confirm → apply → verify

AskUserQuestion, back up, Edit. Re-run `--find` for each subject and show the remaining lines all agree.

**NEVER** resolve a policy conflict (deploy, push, data deletion, customer data) without asking; never weaken a safety rule to remove a conflict — strengthen the other side instead.
