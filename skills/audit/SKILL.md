---
name: audit
description: Scored health check of Claude Code's context for the current project — budget, routing, consistency, transparency, safety — with P0-P3 findings and the context-doctor command to run next. Use when the user asks to audit, review or "see" their Claude Code setup, skills, rules or context.
user-invocable: true
argument-hint: "[focus: budget | routing | consistency | transparency | safety]"
---

## MANDATORY PREPARATION

Invoke `/context-doctor:context-doctor` and follow its **Context Gathering Protocol** (fresh scan, pull specifics, read your own system prompt, verify every finding at file:line). Anti-pattern codes come from its `reference/anti-patterns.md`.

---

Document, don't fix. Every finding must cite a source (file:line, hook id, MCP server, or "system prompt") and be verified by reading it. If the user named a focus, score all five but go deep only there.

## Diagnostic Scan

Score each dimension 0–4.

### 1. Budget
Always-loaded memory tokens (`stats.alwaysTokens`; path-scoped rules with `lazy: true` don't count), user-level `@imports`, listing size vs budget (`stats.listingTokensIfFull` vs `listingBudget`, which is ≈1% of the context window — check `contextWindowFrom` — and bare names in your listing), unused weight (`--usage`: window use plus lifetime counters, idle MCP servers), slow hooks (CL-18).
**0** >25k always-loaded or listing collapsed to bare names for most entries · **1** >15k or many own skills lost descriptions · **2** 8–15k, some truncation · **3** <8k, listing fits, a little dead weight · **4** lean, every enabled plugin earns its place.

### 2. Routing
Missing/vague descriptions (CL-03), aggressive triggers (CL-04), overlapping owners (CL-05, `topics`), duplicates (CL-12), broken definition files (CL-17: skills whose YAML drops every field, agents that never load or collide). Ask for each common job in this project (review, plan, test, deploy, debug, UI): is there exactly one obvious owner?
**0** most jobs have 5+ competing owners incl. aggressive ones · **1** several jobs contested, own skills invisible · **2** contested in places, owners undocumented · **3** one owner per job, minor overlap · **4** every job has one documented owner.

### 3. Consistency
`ruleConflicts` verified line by line (CL-06), MCP instructions vs memory (CL-15), stale memory (CL-11: check that files/commands/servers named in memory exist), personal memory repeating checked-in files (`localDuplicates`).
**0** core rules contradict (e.g. deploy/push policy) · **1** several verified contradictions · **2** one or two, or notable staleness · **3** only cosmetic drift · **4** consistent and current.

### 4. Transparency
Hooks that rewrite, compress, inject, format or deny (CL-08), session-start injections (CL-09). Is each one mentioned anywhere the model reads? Use `usage.denials` to see which hooks or rules actually blocked tool calls.
**0** behavior-changing hooks undocumented and already caused misreads · **1** several undocumented · **2** some documented · **3** all documented, a few noisy · **4** minimal hooks, all documented.

### 5. Safety
Plaintext secrets (CL-10: MCP env/headers/args, hook commands, settings `env`, credentials in always-loaded memory), auto-action invitations (CL-07), untrusted instructions in third-party skills/hooks (CL-16).
**0** live secret in plaintext *and* an auto deploy/push path · **1** either of those · **2** risky wording or hooks, no direct exposure · **3** minor · **4** clean.

## Scope: what `/doctor` covers instead

Claude Code's built-in `/doctor` checks the installation: duplicate or leftover installs, PATH, version currency, settings files that fail to parse, default permission mode, allow rules for commands that keep getting denied. Don't score those here. If you notice one (a settings file that won't parse, an outdated version, many `permission-rule` denials on read-only commands), list it under "Outside this audit" and recommend `/doctor`.

## Generate Report

### Context Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Budget | ? | |
| 2 | Routing | ? | |
| 3 | Consistency | ? | |
| 4 | Transparency | ? | |
| 5 | Safety | ? | |
| **Total** | | **??/20** | **[band]** |

Bands: 18–20 Excellent · 14–17 Good · 10–13 Acceptable · 6–9 Poor · 0–5 Critical.

### What the model actually receives
Start here. Three to five lines: always-loaded tokens and the biggest file, how many listing entries arrived without description (count them in your own listing), which hooks change what you see, which MCP instructions are in force. This is the "black box" the user asked to open — be concrete.

### Executive Summary
- Score and band
- Issue counts P0/P1/P2/P3
- Top 3–5 issues
- Next steps

### Findings by Severity
- **P0 Blocking** — causes wrong or unsafe actions now (secret exposure, auto deploy/push, contradiction on a destructive action)
- **P1 Major** — reliably degrades behavior (own skills invisible, aggressive owners fighting, undocumented rewriting hooks)
- **P2 Minor** — waste or friction (bloat, duplicates, stale lines)
- **P3 Polish**

For each:
- **[P?] Name** (CL-xx)
- **Source**: file:line / hook id / MCP server / system prompt
- **Evidence**: the verbatim line(s), short
- **Impact**: what goes wrong in practice, ideally an observed instance from this session
- **Fix**: specific edit or setting
- **Command**: `/context-doctor:distill | sharpen | harmonize | annotate | secure`

### Systemic Patterns
E.g. "one plugin contributes 80% of listing and all aggressive agents", "rules live in three places with no precedence".

### Outside this audit
Installation and permission issues noticed along the way → `/doctor`. Omit the section if there are none.

### What's Working
Name the good parts (clear project skills, explicit governance rules, spec workflow) so they survive cleanup.

## Recommended Actions
Priority order, P0 first:
1. **[P?] `/context-doctor:<cmd>`** — what it will change, with the specific targets

End with `/context-doctor:audit` to re-score, and `/context-doctor:view` to see it.

## Save the verified score

Write the scores so `/context-doctor:view` shows them instead of the automatic estimate:

```bash
D=$(node "${CLAUDE_PLUGIN_ROOT}/scanner/scan.mjs" --print-dir)
cat > "$D/audit.json" <<'JSON'
{ "project": "<report.project, e.g. ~/Desktop/myproj>", "generatedAt": "<ISO now>",
  "scores": { "budget": 0, "routing": 0, "consistency": 0, "transparency": 0, "safety": 0 },
  "keyFindings": { "budget": "<one line>", "routing": "…", "consistency": "…", "transparency": "…", "safety": "…" },
  "total": 0, "band": "<band>" }
JSON
```
Use the exact `project` string from `report.json`. Each project keeps its own audit, so auditing another project never replaces this score. Then rerun `node "${CLAUDE_PLUGIN_ROOT}/scanner/scan.mjs" >/dev/null` so the page picks it up.

Then tell the user, in their language:
> Run these one at a time or all together. Every fix command shows a change table and asks before writing any file. Re-run `/context-doctor:audit` afterwards to see the score move.

**NEVER**
- report a scanner conflict you have not read at its source
- recommend editing files in `~/.claude/plugins/cache/`
- print secret values
- give everything P1 — prioritize
- skip the "What the model actually receives" section
