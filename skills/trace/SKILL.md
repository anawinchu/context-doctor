---
name: trace
description: Explain why Claude Code did something — find which CLAUDE.md line, memory file, skill, agent description, hook or MCP instruction produced a specific behavior, and how strongly. Use when the user asks "why did Claude do X", "where does this rule come from", or "why wasn't skill Y used".
user-invocable: true
argument-hint: "<behavior, e.g. 'why it asked before deploying' | 'why new-api-route never triggers'>"
---

## MANDATORY PREPARATION

Invoke `/context-doctor:context-doctor` and run its Context Gathering Protocol (a fresh `--summary` is enough; skip the full audit).

---

## 1. Restate the behavior

One sentence, observable: what was done or not done, when. If vague, ask one question.

## 2. Collect candidate causes

- `node "${CLAUDE_PLUGIN_ROOT}/scanner/scan.mjs" --find "<2-4 keyword regex>"` — rules, descriptions and hooks mentioning it.
- Your own system prompt: harness rules, MCP server instructions, the skill listing entry (present? with description?).
- Hooks on the relevant event (`report.hooks`), and anything injected this session (`/context-doctor-live`, or `<system-reminder>`/hook context you received).
- For "why wasn't X used": is X enabled, does it have a description in *your* listing, how many other items claim the same job (`report.topics`), is there an aggressive competitor?

## 3. Rank

For each cause: **source · line · loaded when (always / on invoke / hook) · strength** (explicit imperative > example > implied) · **verdict** (primary / contributing / unrelated). Read each source at the line before ranking.

## 4. Answer

Short: the primary cause with its verbatim line, contributing causes, and the smallest change that would alter the behavior (pointing to `/context-doctor:harmonize`, `sharpen`, `distill` or `annotate`). Do not change anything in this command.
