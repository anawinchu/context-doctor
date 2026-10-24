#!/usr/bin/env node
// Context Doctor scanner — reads every source that feeds Claude Code's context
// (memory files, skills, commands, agents, plugins, hooks, MCP servers) and writes
// report.json + report.html. Read-only except --set-plugin and --dismiss. No dependencies.
//
//   node scan.mjs [--project <dir>] [--out <dir>] [--lang en|th]
//                 [--summary | --json | --usage [--all-projects] | --diff [--exit-code]
//                  | --find <regex> | --plugins | --set-plugin <id> on|off
//                  | --dismiss "<subject>::<source>" | --print-lang | --print-dir]
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HOME = os.homedir()
const CLAUDE = process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(HOME, '.claude')
const args = process.argv.slice(2)
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const PROJECT = path.resolve(argVal('--project', process.cwd()))
const OUT = path.resolve(argVal('--out', path.join(CLAUDE, 'context-doctor')))
const HERE = path.dirname(fileURLToPath(import.meta.url))

// ---------- helpers ----------
const exists = p => { try { fs.accessSync(p); return true } catch { return false } }
const isDir = p => { try { return fs.statSync(p).isDirectory() } catch { return false } }
const readText = p => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const ls = p => { try { return fs.readdirSync(p) } catch { return [] } }
const tilde = p => p && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p
const untilde = p => p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p
const projectSlug = dir => dir.replace(/[^A-Za-z0-9]/g, '-')
// per-project state (report, usage, audit) so scanning project B never overwrites project A
const PDIR = path.join(OUT, 'projects', projectSlug(PROJECT))
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 1)) }
// state files from 1.0 lived directly in OUT; read them once if they belong to this project
const readState = name => readJson(path.join(PDIR, name)) || (p => p && p.project === tilde(PROJECT) ? p : null)(readJson(path.join(OUT, name)))

// ---------- redaction ----------
// Values that look like credentials never reach report.json/html, --find or the terminal.
const R_ = '«redacted»'
const REDACTIONS = [
  [/\b(Authorization|Proxy-Authorization|X-Api-Key|Api-Key|X-Auth-Token)(["']?\s*[:=]\s*["']?)(Bearer\s+|Basic\s+|Token\s+)?[^\s"',;]+/gi, (m, k, sep, scheme = '') => `${k}${sep}${scheme}${R_}`],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, () => `Bearer ${R_}`],
  [/\b(sk-[A-Za-z0-9_-]{12,}|sk_live_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, () => R_],
  [/(--?(?:password|passwd|pwd|token|secret|api[-_]?key|access[-_]?key|client[-_]?secret)(?:=|\s+)|\b(?:password|passwd|pwd|token|secret|api[-_]?key|access[-_]?key|client[-_]?secret)(?:=|:\s*))(["'`]?)(?!\$\{|\$[A-Z_]|<|«)[^\s"'`,;)]{3,}\2/gi, (m, k, q) => `${k}${q}${R_}${q}`],
  [/(\b[A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY)=)(["']?)(?!\$)[^\s"']+\2/g, (m, k, q) => `${k}${q}${R_}${q}`],
  [/(:\/\/[^\s:/@]+:)[^\s@/]+@/g, (m, k) => `${k}${R_}@`],
]
const redact = s => typeof s === 'string' ? REDACTIONS.reduce((t, [re, f]) => t.replace(re, f), s) : s
const SECRET_KEY = /pass|secret|token|apikey|api_key|key$|pwd/i
const hasSecret = s => typeof s === 'string' && redact(s) !== s
// credentials written in prose (memory files): "password `123456`", "รหัสผ่าน 1234", "user@x.com / pw"
const PROSE_CRED = [
  /(\bpass(?:word|wd)?s?\b|\bpwd\b|รหัสผ่าน|รหัส(?=[\s:=`]))\s*(?:is|=|:|คือ)?\s*[`"']?(?!\$\{|<|«|\()([^\s`"',)(]{4,})/i,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+\s*\/\s*[`"']?([^\s`"',)]{4,})/,
]
// a value counts when it has a digit or was quoted — "password policy" and `hashPassword()` do not
const proseCred = line => PROSE_CRED.some(re => {
  const m = line.match(re)
  if (!m) return false
  const v = m[m.length - 1], before = m[0].slice(0, m[0].lastIndexOf(v))
  return /\d/.test(v) || /[`"']$/.test(before) && !/^[a-z]+[A-Z]\w*$/.test(v)
})
const redactProse = s => proseCred(s) ? PROSE_CRED.reduce((t, re) => t.replace(new RegExp(re.source, re.flags + 'g'), (m, ...g) => { const v = g[re === PROSE_CRED[0] ? 1 : 0]; return typeof v === 'string' ? m.replace(v, R_) : m }), s) : s

// ---------- config + language ----------
// ~/.claude/context-doctor/config.json may override: lang, listingBudget, thaiTokensPerChar, otherCharsPerToken
const userSettings = readJson(path.join(CLAUDE, 'settings.json')) || {}
const CONFIG = readJson(path.join(OUT, 'config.json')) || {}
const LANG = (() => {
  const v = argVal('--lang') || process.env.CONTEXT_DOCTOR_LANG || CONFIG.lang || userSettings.language || ''
  return /^th|thai|ไทย/i.test(v) ? 'th' : 'en'
})()
const T = (en, th) => (LANG === 'th' ? th : en)
const LOCALE = T('en-US', 'th-TH')
const n = x => Number(x || 0).toLocaleString(LOCALE)

if (args.includes('--print-lang')) { console.log(LANG); process.exit(0) }
if (args.includes('--print-dir')) { fs.mkdirSync(PDIR, { recursive: true }); console.log(PDIR); process.exit(0) }

// --set-plugin <id> on|off: write enabledPlugins in the project's .claude/settings.local.json (applies next session).
// Local settings are personal (gitignored) and override user and project settings, so one person's toggle never
// reaches the team through the checked-in .claude/settings.json.
if (args.includes('--set-plugin')) {
  const id = argVal('--set-plugin'), on = args[args.indexOf('--set-plugin') + 2]
  if (!id || !['on', 'off'].includes(on)) { console.error('usage: --set-plugin <id> on|off'); process.exit(2) }
  if (!/^[\w.:-]+@[\w.:-]+$/.test(id)) { console.error(`refusing suspicious plugin id: ${JSON.stringify(id)}`); process.exit(2) }
  const file = path.join(PROJECT, '.claude/settings.local.json')
  if (exists(file)) fs.copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`)
  const json = readJson(file) || {}
  json.enabledPlugins = { ...(json.enabledPlugins || {}), [id]: on === 'on' }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
  console.log(`${id} → ${on} (${tilde(file)})`)
  try { execFileSync('git', ['-C', PROJECT, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' }) } catch { process.exit(0) }
  try { execFileSync('git', ['-C', PROJECT, 'check-ignore', '-q', file], { stdio: 'ignore' }) } catch {
    console.log(T('note: .claude/settings.local.json is not gitignored in this repo — add it to .gitignore so the toggle stays personal.', 'หมายเหตุ: repo นี้ยังไม่ได้ gitignore .claude/settings.local.json ควรเพิ่มลง .gitignore เพื่อให้การตั้งค่านี้เป็นของคุณคนเดียว'))
  }
  process.exit(0)
}

// --dismiss "<subject>::<source>": record a rule-conflict candidate a human ruled out (shared across projects)
if (args.includes('--dismiss')) {
  const key = argVal('--dismiss')
  if (!key || !key.includes('::')) { console.error('usage: --dismiss "<subject>::<source>" (the key printed with each conflict)'); process.exit(2) }
  const file = path.join(OUT, 'dismissed.json')
  const list = new Set(readJson(file) || [])
  list.add(key)
  writeJson(file, [...list])
  console.log(`${T('dismissed', 'ซ่อนแล้ว')}: ${key} (${tilde(file)})`)
  process.exit(0)
}

// Token estimate calibrated against /context (within ~5% on mixed Thai/English files).
// Thai script tokenizes far denser than Latin text, so it is counted separately.
const THAI_TOKENS_PER_CHAR = CONFIG.thaiTokensPerChar ?? 1.44
const OTHER_CHARS_PER_TOKEN = CONFIG.otherCharsPerToken ?? 2.46
const thaiCount = s => (s.match(/[฀-๿]/g) || []).length
function tokens(s) {
  if (!s) return 0
  const thai = thaiCount(s)
  return Math.round(thai * THAI_TOKENS_PER_CHAR + (s.length - thai) / OTHER_CHARS_PER_TOKEN)
}

// Lenient parser plus a strict-enough check: Claude Code drops EVERY field of a skill whose YAML fails to
// parse (name falls back to the folder, description to the first body line), and nothing warns.
// strict: also flag `key: value: more` — skills fail on it; agent loading tolerates it
function frontmatter(text, strict = false) {
  if (!text || !text.startsWith('---')) return { meta: {}, body: text || '', problems: [] }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, body: text, problems: [{ line: 1, problem: 'frontmatter is never closed with ---' }] }
  const raw = text.slice(3, end).split('\n')
  const body = text.slice(end + 4)
  const meta = {}, problems = []
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i], at = i + 1 // file line (the opening --- is line 1)
    if (/^\t/.test(line)) problems.push({ line: at, problem: 'tab indentation (YAML allows spaces only)' })
    if (!line.trim() || /^\s*#/.test(line)) continue
    const m = line.match(/^([A-Za-z0-9_-]+):(?:\s+(.*)|\s*)$/)
    if (!m) { if (!/^\s/.test(line) && !/^-\s/.test(line)) problems.push({ line: at, problem: 'not a "key: value" line' }); continue }
    let [, k, v = ''] = m
    if (k in meta) problems.push({ line: at, problem: `duplicate key "${k}"` })
    if (v === '>' || v === '|' || v === '>-' || v === '|-' || v === '') {
      const lines = []
      while (i + 1 < raw.length && (/^\s+/.test(raw[i + 1]) || raw[i + 1] === '' || /^-\s/.test(raw[i + 1]))) lines.push(raw[++i].trim())
      v = lines.join(v.startsWith('|') ? '\n' : ' ').trim()
    } else if (strict && !/^["'[{]/.test(v) && /:\s/.test(v)) {
      problems.push({ line: at, problem: `unquoted value of "${k}" contains ": " — wrap it in quotes` })
    } else if ((/^"/.test(v) && !/"\s*$/.test(v) || /^'/.test(v) && !/'\s*$/.test(v)) && !/^\s+\S/.test(raw[i + 1] || '')) {
      problems.push({ line: at, problem: `quoted value of "${k}" is not closed on its line` })
    }
    meta[k] = v.replace(/^["'](.*)["']$/s, '$1')
  }
  return { meta, body, problems }
}

// ---------- rule extraction ----------
// type: never | must | trigger
const RULE_PATTERNS = [
  { type: 'never', re: /ไม่ได้ ?(build|commit|push|deploy)|\b(NEVER|DO NOT|DON'T|Do not|Don't|Never|MUST NOT|must not|should not|Avoid)\b|ห้าม|อย่า(?!งไร|งน้อย|งเช่น|งละ)/ },
  { type: 'must', re: /\b(MUST|ALWAYS|Always|REQUIRED|required to|IMPORTANT|CRITICAL|must)\b|ต้อง|ทุกครั้ง|เท่านั้น/ },
  { type: 'trigger', re: /\b(PROACTIVELY|MUST BE USED|Use immediately|TRIGGER|Use when|Use this (skill|agent) when|Automatically activated)\b/i },
]
function extractRules(text, source, file, baseLine = 0) {
  if (!text) return []
  const out = []
  let inCode = false
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { inCode = !inCode; return }
    if (inCode) return
    const t = line.replace(/^[\s>*#\-0-9.)]+/, '').trim()
    if (t.length < 8 || t.length > 400) return
    const p = RULE_PATTERNS.find(p => p.re.test(t))
    if (p) out.push({ type: p.type, text: redact(redactProse(t)), source, file: tilde(file), line: baseLine + i + 1 })
  })
  return out
}

// ---------- memory files (loaded every session) ----------
// lazy: .claude/rules/*.md with `paths` frontmatter load only when Claude works with matching files
const memory = [], memoryCreds = []
function addMemory(file, scope, via, seen = new Set()) {
  if (!file || seen.has(file) || !exists(file)) return
  seen.add(file)
  const text = readText(file) || ''
  const fm = scope === SCOPE.rules ? frontmatter(text).meta : {}
  const lazy = !!fm.paths
  text.split('\n').forEach((line, i) => { if (proseCred(line)) memoryCreds.push({ file: tilde(file), line: i + 1, lazy }) })
  memory.push({ file: tilde(file), scope, via, lazy, paths: fm.paths || null, tokens: tokens(text), lines: text.split('\n').length, rules: extractRules(text, tilde(file), file) })
  let inCode = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { inCode = !inCode; continue }
    if (inCode) continue
    for (const m of line.matchAll(/(?:^|\s)@([~./A-Za-z0-9_-][^\s`)]*\.md)\b/g)) {
      const p = m[1].startsWith('~') ? untilde(m[1]) : path.resolve(path.dirname(file), m[1])
      addMemory(p, scope, tilde(file), seen)
    }
  }
}
const SCOPE = { user: T('user (all projects)', 'ผู้ใช้ (ทุกโปรเจกต์)'), project: T('project', 'โปรเจกต์'), parent: T('parent folder', 'โฟลเดอร์แม่'), rules: T('project rules', 'โปรเจกต์ (rules)'), auto: 'auto-memory' }
addMemory(path.join(CLAUDE, 'CLAUDE.md'), SCOPE.user, 'auto')
{
  const chain = []
  let d = PROJECT
  while (d && d !== path.dirname(d) && d.startsWith(HOME) && d !== HOME) { chain.unshift(d); d = path.dirname(d) }
  for (const dir of chain) for (const f of ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']) addMemory(path.join(dir, f), dir === PROJECT ? SCOPE.project : SCOPE.parent, 'auto')
  const rulesDir = (dir, depth = 0) => depth > 4 ? [] : ls(dir).flatMap(x => isDir(path.join(dir, x)) ? rulesDir(path.join(dir, x), depth + 1) : x.endsWith('.md') ? [path.join(dir, x)] : [])
  for (const f of rulesDir(path.join(PROJECT, '.claude/rules'))) addMemory(f, SCOPE.rules, 'auto')
  addMemory(path.join(CLAUDE, 'projects', projectSlug(PROJECT), 'memory', 'MEMORY.md'), SCOPE.auto, 'auto')
}
const isUserScope = m => m.scope === SCOPE.user
const alwaysMemory = memory.filter(m => !m.lazy)
// local = personal, never checked in: ~/.claude/CLAUDE.md (+ its imports) and CLAUDE.local.md
const isLocalMemory = m => isUserScope(m) || /CLAUDE\.local\.md$/.test(m.file)
const isCheckedIn = m => !isLocalMemory(m) && m.scope !== SCOPE.auto

// ---------- settings ----------
const settingsFiles = [
  { scope: T('user', 'ผู้ใช้'), file: path.join(CLAUDE, 'settings.json') },
  { scope: T('user (local)', 'ผู้ใช้ (local)'), file: path.join(CLAUDE, 'settings.local.json') },
  { scope: T('project', 'โปรเจกต์'), file: path.join(PROJECT, '.claude/settings.json') },
  { scope: T('project (local)', 'โปรเจกต์ (local)'), file: path.join(PROJECT, '.claude/settings.local.json') },
].map(s => ({ ...s, json: readJson(s.file) })).filter(s => s.json)
const enabledPlugins = {}, skillOverrides = {}
for (const s of settingsFiles) { Object.assign(enabledPlugins, s.json.enabledPlugins || {}); Object.assign(skillOverrides, s.json.skillOverrides || {}) }

// ---------- skills / commands / agents ----------
const items = []
const AGGRESSIVE = /PROACTIVELY|MUST BE USED|Use immediately|Automatically activated|ALWAYS use|always invoke/i
// "no PROACTIVELY pressure", "remove MUST BE USED" describe the words, not use them
const MENTIONS_ONLY = /\b(no|without|remove|removes|avoid|drop)\b[^.]{0,40}(PROACTIVELY|MUST BE USED)/i
const SRC = { user: T('user', 'ผู้ใช้'), project: T('project', 'โปรเจกต์'), sync: 'claude.ai sync', plugin: 'plugin' }
function addItem(kind, name, file, source, plugin) {
  const text = readText(file)
  if (text == null) return
  const { meta, body, problems } = frontmatter(text, kind !== 'agent')
  const desc = (meta.description || '').trim()
  const short = meta.name || name
  const full = plugin ? `${plugin}:${short}` : short
  items.push({
    kind, name: full, short, source, plugin: plugin || null, file: tilde(file),
    declaredName: meta.name || null, problems: problems.length ? problems : undefined,
    description: desc, descTokens: tokens(desc), bodyTokens: tokens(body),
    tools: meta.tools || meta['allowed-tools'] || null, model: meta.model || null,
    aggressive: AGGRESSIVE.test(desc) && !MENTIONS_ONLY.test(desc),
    disabled: skillOverrides[short] === 'off' || skillOverrides[full] === 'off' || meta['disable-model-invocation'] === 'true',
    rules: extractRules(body, full, file, text.slice(0, text.length - body.length).split('\n').length - 1),
  })
}
function findSkillDirs(dir, depth = 0, skip = []) {
  if (!isDir(dir)) return []
  if (exists(path.join(dir, 'SKILL.md'))) return [dir]
  if (depth > 3) return []
  return ls(dir).filter(x => !x.startsWith('.') && x !== 'node_modules' && !skip.includes(x)).flatMap(x => findSkillDirs(path.join(dir, x), depth + 1))
}
function mdFiles(dir, depth = 0) {
  if (!isDir(dir) || depth > 2) return []
  return ls(dir).flatMap(x => {
    const p = path.join(dir, x)
    if (isDir(p)) return mdFiles(p, depth + 1)
    return x.endsWith('.md') && !/^readme/i.test(x) ? [p] : []
  })
}
const scanSkillRoot = (root, source, plugin, skip) => { for (const d of findSkillDirs(root, 0, skip)) addItem('skill', path.basename(d), path.join(d, 'SKILL.md'), source, plugin) }
scanSkillRoot(path.join(CLAUDE, 'skills'), SRC.user, null, ['synced'])
for (const f of mdFiles(path.join(CLAUDE, 'commands'))) addItem('command', path.basename(f, '.md'), f, SRC.user)
for (const x of ls(path.join(CLAUDE, 'agents'))) {
  const p = path.join(CLAUDE, 'agents', x)
  if (x.endsWith('.md')) addItem('agent', path.basename(x, '.md'), p, SRC.user)
  else if (isDir(p)) for (const f of mdFiles(p)) addItem('agent', path.basename(f, '.md'), f, SRC.sync) // claude.ai-synced bucket
}
scanSkillRoot(path.join(PROJECT, '.claude/skills'), SRC.project)
for (const f of mdFiles(path.join(PROJECT, '.claude/agents'))) addItem('agent', path.basename(f, '.md'), f, SRC.project)
for (const f of mdFiles(path.join(PROJECT, '.claude/commands'))) addItem('command', path.basename(f, '.md'), f, SRC.project)
for (const b of ls(path.join(CLAUDE, 'skills/synced')).filter(x => !x.startsWith('.'))) scanSkillRoot(path.join(CLAUDE, 'skills/synced', b), SRC.sync, 'anthropic-skills')

// ---------- plugins ----------
const installed = readJson(path.join(CLAUDE, 'plugins/installed_plugins.json'))?.plugins || {}
const plugins = [], hooks = [], mcp = []
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v]
function scanPlugin(id, root, scope, enabled) {
  const manifest = readJson(path.join(root, '.claude-plugin/plugin.json')) || {}
  const name = manifest.name || id.split('@')[0]
  const before = items.length
  const orphaned = ls(path.dirname(root)).filter(v => exists(path.join(path.dirname(root), v, '.orphaned_at'))).length
  const hasLsp = !!(manifest.lspServers || exists(path.join(root, '.lsp.json')))
  const p = { id, name, version: manifest.version || '?', scope, enabled, root: tilde(root), description: manifest.description || '', orphanedVersions: orphaned, counts: {}, hasLsp }
  plugins.push(p)
  if (!enabled) return
  for (const s of manifest.skills != null ? arr(manifest.skills) : ['./skills']) scanSkillRoot(path.resolve(root, s), SRC.plugin, name)
  for (const c of manifest.commands != null ? arr(manifest.commands) : ['./commands']) for (const f of mdFiles(path.resolve(root, c))) addItem('command', path.basename(f, '.md'), f, SRC.plugin, name)
  for (const a of manifest.agents != null ? arr(manifest.agents) : ['./agents']) for (const f of mdFiles(path.resolve(root, a))) addItem('agent', path.basename(f, '.md'), f, SRC.plugin, name)
  const added = items.slice(before)
  p.counts = { skill: added.filter(i => i.kind === 'skill').length, agent: added.filter(i => i.kind === 'agent').length, command: added.filter(i => i.kind === 'command').length }
  const hj = typeof manifest.hooks === 'string' ? readJson(path.resolve(root, manifest.hooks)) : manifest.hooks || readJson(path.join(root, 'hooks/hooks.json'))
  if (hj) collectHooks(hj.hooks || hj, `plugin ${name}`)
  const mj = manifest.mcpServers && Object.keys(manifest.mcpServers).length ? manifest.mcpServers : readJson(path.join(root, '.mcp.json'))?.mcpServers || readJson(path.join(root, '.mcp.json'))
  if (mj && typeof mj === 'object') for (const [k, v] of Object.entries(mj)) if (v && typeof v === 'object' && (v.command || v.url)) addMcp(k, v, `plugin ${name}`)
  p.counts.hooks = hooks.filter(h => h.source === `plugin ${name}`).length
  p.counts.mcp = mcp.filter(m => m.source === `plugin ${name}`).length
  // usage signal: invocable surfaces are counted; LSP only by pluginUsage; themes/styles/monitors never
  p.signal = p.counts.skill + p.counts.command + p.counts.agent + p.counts.hooks + p.counts.mcp > 0 ? 'invocable' : hasLsp ? 'lsp' : 'none'
}
for (const [id, entries] of Object.entries(installed)) {
  const e = entries.find(x => x.scope !== 'project' || x.projectPath === PROJECT)
  if (e) scanPlugin(id, e.installPath, e.scope, enabledPlugins[id] === true)
}
for (const b of ls(path.join(CLAUDE, 'plugins/synced')).filter(x => !x.startsWith('.'))) {
  const dir = path.join(CLAUDE, 'plugins/synced', b)
  for (const x of ls(dir)) if (isDir(path.join(dir, x, '.claude-plugin'))) scanPlugin(`${x}@claude.ai`, path.join(dir, x), SRC.sync, true)
}

// ---------- hooks ----------
function summarizeCmd(c) {
  if (!c) return ''
  c = redact(c)
  const script = [...c.matchAll(/([\w./-]+\.(?:js|mjs|py|sh|ts))\b/g)].map(m => m[1]).filter(s => !/bootstrap|hook-script/.test(s)).pop()
  if (c.length > 140 && script) return '… ' + script
  return c.length > 140 ? c.slice(0, 137) + '…' : c
}
function collectHooks(obj, source) {
  for (const [event, groups] of Object.entries(obj || {})) {
    if (!Array.isArray(groups)) continue
    for (const g of groups) for (const h of g.hooks || []) hooks.push({ event, matcher: g.matcher || '*', source, id: g.id || null, description: g.description || '', command: summarizeCmd(h.command || h.prompt || ''), type: h.type, timeout: h.timeout || null, hasSecret: hasSecret(h.command || '') || undefined })
  }
}
for (const s of settingsFiles) collectHooks(s.json.hooks, `settings ${s.scope}`)

// ---------- MCP ----------
function addMcp(name, cfg, source) {
  const secrets = []
  for (const [k, v] of Object.entries(cfg.env || {})) if (SECRET_KEY.test(k) && typeof v === 'string' && v && !v.startsWith('${')) secrets.push(k)
  for (const [k, v] of Object.entries(cfg.headers || {})) if (/auth|key|token/i.test(k) && typeof v === 'string' && !v.includes('${')) secrets.push('header ' + k)
  const target = cfg.url || [cfg.command, ...(cfg.args || [])].join(' ')
  if (hasSecret(target)) secrets.push(cfg.url ? 'url' : 'args')
  mcp.push({ name, source, transport: cfg.type || (cfg.url ? 'http' : 'stdio'), target: redact(target).slice(0, 120), secrets })
}
for (const s of settingsFiles) for (const [k, v] of Object.entries(s.json.mcpServers || {})) addMcp(k, v, `settings ${s.scope}`)
const claudeJson = readJson(path.join(HOME, '.claude.json')) || {}
for (const [k, v] of Object.entries(claudeJson.mcpServers || {})) addMcp(k, v, `~/.claude.json (${T('user', 'ผู้ใช้')})`)
const projCfg = claudeJson.projects?.[PROJECT] || {}
for (const [k, v] of Object.entries(projCfg.mcpServers || {})) addMcp(k, v, `~/.claude.json (${T('project', 'โปรเจกต์')})`)
for (const [k, v] of Object.entries(readJson(path.join(PROJECT, '.mcp.json'))?.mcpServers || {})) addMcp(k, v, `.mcp.json (${T('project', 'โปรเจกต์')})`)
// claude.ai connectors live in the account, not on disk; ~/.claude.json lists the ones this machine has connected
for (const k of claudeJson.claudeAiMcpEverConnected || []) if (typeof k === 'string' && !mcp.some(m => m.name === k)) mcp.push({ name: k, source: 'claude.ai connector', transport: 'claude.ai', target: T('(your claude.ai account)', '(บัญชี claude.ai ของคุณ)'), secrets: [] })
const disabledMcp = new Set(projCfg.disabledMcpServers || [])
for (const m of mcp) m.disabled = disabledMcp.has(m.name)
// transcripts name tools mcp__<normalized>__; plugin servers become plugin_<plugin>_<server>, connectors claude_ai_<name>
const mcpKey = m => (m.source === 'claude.ai connector' ? m.name.replace(/^claude\.ai\s+/, 'claude_ai_') : m.source.startsWith('plugin ') ? `plugin_${m.source.slice(7)}_${m.name}` : m.name).replace(/[^a-zA-Z0-9_-]/g, '_')
for (const m of mcp) m.key = mcpKey(m)

// MCP server instructions are part of the system prompt. The side pane saves the composed prompt to
// system-prompt.md; when it exists, attach each server's instructions so conflicts with memory show up.
const promptFile = path.join(OUT, 'system-prompt.md')
const promptText = readText(promptFile)
const mcpRules = []
if (promptText) {
  const at = promptText.indexOf('# MCP Server Instructions')
  if (at >= 0) {
    const tail = promptText.slice(at).split('\n').slice(1)
    const stop = tail.findIndex(l => /^# /.test(l) || /^<!-- section:/.test(l))
    const block = (stop >= 0 ? tail.slice(0, stop) : tail).join('\n')
    for (const part of block.split(/^## /m).slice(1)) {
      const [head, ...rest] = part.split('\n'), name = head.trim(), text = rest.join('\n').trim()
      let m = mcp.find(x => x.name === name)
      if (!m) mcp.push(m = { name, source: T('system prompt', 'system prompt'), transport: '?', target: '', secrets: [], key: name.replace(/[^a-zA-Z0-9_-]/g, '_') })
      const rules = extractRules(text, `MCP ${name}`, promptFile)
      m.instructions = { tokens: tokens(text), rules: rules.length }
      mcpRules.push(...rules.map(r => ({ ...r, file: '(system prompt)', line: 0 })))
    }
  }
}
const promptCapturedAt = promptText ? fs.statSync(promptFile).mtime.toISOString() : null

// literal secrets in settings `env` blocks (settings files get synced, shared and backed up)
const envSecrets = []
const ENV_SECRET = /(PASS(WORD|WD)?|SECRET|(^|_)TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?)$/i
for (const s of settingsFiles) for (const [k, v] of Object.entries(s.json.env || {})) if (ENV_SECRET.test(k) && typeof v === 'string' && v && !v.includes('${')) envSecrets.push({ file: tilde(s.file), key: k })

// ---------- harness baseline (paraphrased from Claude Code's system prompt; not on disk) ----------
const HARNESS = 'Harness (system prompt)'
const harnessRules = [
  ['never', 'Commit or push only when the user asks.'],
  ['must', 'For actions that are hard to reverse or outward-facing, confirm first unless durably authorized.'],
  ['never', "Do the work yourself when it is a handful of tool calls; when in doubt, don't spawn a subagent."],
  ['must', 'Prefer the dedicated file/search tools over shell commands when one fits.'],
  ['must', 'Write code that reads like the surrounding code: match its comment density, naming, and idiom.'],
  ['must', 'Respond in the configured language (settings.language).'],
].map(([type, text]) => ({ type, text, source: HARNESS, file: '(system prompt)', line: 0 }))

// ---------- analysis ----------
const allRules = [...harnessRules, ...memory.flatMap(m => m.rules), ...items.filter(i => !i.disabled).flatMap(i => i.rules), ...mcpRules]
const SEV_ORDER = { high: 0, medium: 1, low: 2 }

// 1) jobs several items claim — matched on name + first sentence of the description
const TOPICS = [
  ['review', T('Code review', 'รีวิวโค้ด'), /code[- ]?review|reviewer|review-pr|\breview\b/i],
  ['test', T('TDD / testing', 'TDD / เขียนเทส'), /\btdd\b|test-driven|testing|test coverage/i],
  ['browser', 'E2E / browser', /\be2e\b|playwright|browser|chrome|puppeteer/i],
  ['ui', T('UI / frontend design', 'ออกแบบ UI / frontend'), /\bui\b|\bux\b|frontend|design system|tailwind|interface/i],
  ['plan', T('Planning / spec', 'วางแผน / spec'), /\bplan(ner|ning)?\b|\bprd\b|\bspec\b|blueprint/i],
  ['research', T('Research', 'research / ค้นคว้า'), /research|literature/i],
  ['deploy', 'Deploy / release', /deploy|release/i],
  ['git', 'Git commit / PR', /\bcommit\b|pull request|\bpr\b/i],
  ['security', 'Security', /secur|vulnerab|owasp/i],
  ['docs', 'Documentation', /documentation|readme|codemap|\bdocs\b/i],
  ['slides', T('Slides / presentations', 'slides / presentation'), /slide|presentation|\bdeck\b|pptx/i],
  ['db', 'Database / migration', /postgres|\bsql\b|migration|database/i],
  ['debug', 'Debug / build errors', /debug|diagnos|build[- ](error|fix|resolver)/i],
  ['memory', 'Memory / session / learning', /\bmemory\b|session|instinct|compact|learn\b/i],
  ['writing', T('Writing / copy', 'การเขียน / copy'), /humaniz|copywrit|copy-edit|prose|article/i],
]
const lead = i => i.short + ' ' + (i.description.split(/(?<=[.!?。])\s/)[0] || '').slice(0, 200)
const topics = TOPICS.map(([id, topic, re]) => {
  const hits = items.filter(i => !i.disabled && re.test(lead(i)))
  const aggressive = hits.filter(i => i.aggressive)
  const severity = aggressive.length >= 2 ? 'high' : hits.length >= 8 ? 'medium' : hits.length >= 3 ? 'low' : null
  return { id, topic, count: hits.length, aggressive: aggressive.map(i => i.name), severity, items: hits.map(i => ({ name: i.name, kind: i.kind, aggressive: i.aggressive })) }
}).filter(t => t.severity).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.count - a.count)

// 2) same short name from several sources
const byShort = {}
for (const i of items) (byShort[i.short.toLowerCase()] ||= []).push(`${i.name} (${i.kind})`)
const duplicates = Object.entries(byShort).filter(([, v]) => v.length > 1).map(([name, v]) => ({ name, items: v }))

// 3) opposite rules on one subject: an always-loaded rule vs a skill/agent rule. Candidates for a human to read.
const SUBJECTS = [
  ['commit / push', /git (commit|push)|`git push`|commit ?(\+|and|&|\/) ?push|\bpush (to |origin)|commit or push|ห้าม commit/i],
  ['deploy', /\bdeploy/i],
  ['spawn subagent', /\bspawn|subagents?\b|sub-agent|Task tool|Agent tool|delegate to/i],
  ['WebFetch', /webfetch|web fetch/i],
  [T('ask the user first', 'ถามผู้ใช้ก่อน'), /ask the user|AskUserQuestion|confirm with the user|confirm first|ถามก่อน/i],
  [T('code comments', 'คอมเมนต์ในโค้ด'), /code comments?|comments? in (the )?code|comment density|docstring/i],
  [T('creating docs files', 'สร้างไฟล์เอกสาร'), /create (a |any )?(\.md|markdown|documentation) files?|\bREADME\b/i],
  [T('reply language', 'ภาษาในการตอบ'), /respond in|reply in|answer in|ตอบเป็นภาษา|in English\b/i],
]
// ~/.claude/context-doctor/dismissed.json: ["<subject>::<source>", ...] — pairs a human already ruled out
const dismissed = new Set(readJson(path.join(OUT, 'dismissed.json')) || [])
const alwaysSources = new Set([HARNESS, ...alwaysMemory.map(m => m.file)])
const ruleConflicts = SUBJECTS.map(([subject, re]) => {
  const rs = allRules.filter(r => r.type !== 'trigger' && re.test(r.text) && !dismissed.has(`${subject}::${r.source}`))
  const pick = (list, k) => { const seen = new Set(); return list.filter(r => !seen.has(r.source) && seen.add(r.source)).slice(0, k) }
  const base = rs.filter(r => alwaysSources.has(r.source)), other = rs.filter(r => !alwaysSources.has(r.source))
  const pairs = []
  for (const [a, b] of [['never', 'must'], ['must', 'never']]) {
    const always = base.filter(r => r.type === a), opposite = other.filter(r => r.type === b)
    const keyed = list => list.map(r => ({ ...r, dismissKey: `${subject}::${r.source}` }))
    if (always.length && opposite.length) pairs.push({ always: keyed(pick(always, 3)), opposite: keyed(pick(opposite, 8)) })
  }
  return pairs.length ? { subject, pairs, sourceCount: new Set(rs.map(r => r.source)).size } : null
}).filter(Boolean)

// 4) listing + memory budget
// The skill listing gets ~1% of the context window; past it, descriptions are dropped and entries arrive as bare names.
const MODEL = [...settingsFiles].reverse().map(s => s.json.model).find(Boolean) || process.env.ANTHROPIC_MODEL || ''
const CONTEXT_WINDOW = CONFIG.contextWindow ?? (/\[1m\]|-1m\b/i.test(MODEL) ? 1_000_000 : 200_000)
const CONTEXT_WINDOW_FROM = CONFIG.contextWindow ? 'config' : /\[1m\]|-1m\b/i.test(MODEL) ? 'model' : 'default'
const LISTING_BUDGET = CONFIG.listingBudget ?? Math.round(CONTEXT_WINDOW * 0.01)
const listingTokens = list => list.filter(i => !i.disabled && i.kind !== 'agent').reduce((a, i) => a + i.descTokens + tokens(i.name) + 2, 0)
const listingTokensIfFull = listingTokens(items)
const noDesc = items.filter(i => !i.description && !i.disabled).map(i => i.name)
const alwaysTokens = alwaysMemory.reduce((a, m) => a + m.tokens, 0)
const memText = alwaysMemory.map(m => readText(untilde(m.file)) || '').join('\n')

// ---------- findings ----------
// cat: budget | routing | consistency | transparency | safety · code: anti-pattern id (CL-xx)
const findings = []
const F = (severity, cat, code, title, detail, fix) => findings.push({ severity, cat, code, title, detail, fix })
const skillCount = items.filter(i => i.kind !== 'agent' && !i.disabled).length
if (listingTokensIfFull > LISTING_BUDGET) F(listingTokensIfFull > LISTING_BUDGET * 2 ? 'high' : 'medium', 'budget', 'CL-02',
  T(`${n(skillCount)} skills/commands overflow the listing budget`, `skill/command ${n(skillCount)} ตัว เกินงบ listing`),
  T(`Showing every description needs ≈${n(listingTokensIfFull)} tokens; Claude Code keeps ≈${n(LISTING_BUDGET)} (≈1% of a ${n(CONTEXT_WINDOW)}-token context${CONTEXT_WINDOW_FROM === 'default' ? ', assumed — set contextWindow in config.json if yours differs' : ''}) and sends the rest as bare names, so the model cannot tell when to use them — your own project skills included.`,
    `ถ้าแสดง description ครบต้องใช้ ≈${n(listingTokensIfFull)} tokens แต่ Claude Code มีที่ราว ${n(LISTING_BUDGET)} (≈1% ของ context ${n(CONTEXT_WINDOW)} tokens${CONTEXT_WINDOW_FROM === 'default' ? ' ซึ่งเป็นค่าที่สมมติไว้ ถ้าไม่ตรงให้ตั้ง contextWindow ใน config.json' : ''}) ส่วนที่เกินถูกส่งเป็นชื่อเปล่า โมเดลจึงไม่รู้ว่าควรใช้เมื่อไร รวมถึง skill ของโปรเจกต์เอง`),
  T('Disable plugins this project does not use (enabledPlugins in <project>/.claude/settings.local.json) or individual skills (skillOverrides: "off"). See /context-doctor:distill.',
    'ปิด plugin ที่โปรเจกต์นี้ไม่ใช้ (enabledPlugins ใน .claude/settings.local.json ของโปรเจกต์) หรือปิดราย skill (skillOverrides: "off") · ดู /context-doctor:distill'))
for (const p of plugins.filter(p => p.enabled && (p.counts.skill + p.counts.command) > 40)) F('medium', 'budget', 'CL-13',
  T(`Plugin ${p.name} adds ${p.counts.skill} skills, ${p.counts.command} commands, ${p.counts.agent} agents`, `plugin ${p.name} เพิ่ม ${p.counts.skill} skills + ${p.counts.command} commands + ${p.counts.agent} agents`),
  T('Catch-all plugins fill the listing and bring agents whose descriptions compete for the same jobs.', 'plugin แบบรวมทุกอย่างทำให้ listing รก และมี agent ที่แย่งงานกัน'),
  T('If you use only a few of its skills, copy those into .claude/skills and disable the plugin for this project.', 'ถ้าใช้แค่บางตัว ให้คัดลอกเฉพาะตัวที่ใช้ไปไว้ใน .claude/skills แล้วปิด plugin ในโปรเจกต์นี้'))
if (alwaysTokens > 8000) F('medium', 'budget', 'CL-01',
  T(`Always-loaded memory ≈${n(alwaysTokens)} tokens`, `memory ที่โหลดทุกครั้ง ≈${n(alwaysTokens)} tokens`),
  alwaysMemory.map(m => `${m.file} ≈ ${n(m.tokens)}`).join(' · '),
  T('Move task-specific material out of CLAUDE.md/@imports into skills, which load only when used; keep MEMORY.md a one-line-per-entry index.', 'ย้ายเนื้อหาเฉพาะงานออกจาก CLAUDE.md/@import ไปเป็น skill ที่โหลดเฉพาะตอนใช้ และให้ MEMORY.md เป็นดัชนีบรรทัดเดียวต่อเรื่อง'))
for (const m of alwaysMemory.filter(m => m.via !== 'auto' && m.tokens > 1500 && isUserScope(m))) F('medium', 'budget', 'CL-01',
  T(`${m.file} (≈${n(m.tokens)} tokens) is @imported at user level, so every project loads it`, `${m.file} (≈${n(m.tokens)} tokens) ถูก @import ระดับผู้ใช้ จึงโหลดทุกโปรเจกต์`),
  T(`Imported from ${m.via}.`, `นำเข้าจาก ${m.via}`),
  T('Turn it into a skill, or import it only from the projects that need it.', 'เปลี่ยนเป็น skill หรือ import เฉพาะในโปรเจกต์ที่ใช้'))
const aggrAgents = items.filter(i => i.kind === 'agent' && i.aggressive && !i.disabled)
if (aggrAgents.length > 5) F('medium', 'routing', 'CL-04',
  T(`${aggrAgents.length} agents use pressure wording ("PROACTIVELY" / "MUST BE USED")`, `${aggrAgents.length} agents เขียน description แบบสั่ง ("PROACTIVELY" / "MUST BE USED")`),
  T(`Pushes the model to spawn agents against the harness rule "when in doubt, don't spawn". e.g. ${aggrAgents.slice(0, 8).map(a => a.name).join(', ')}`, `ขัดกับกฎ harness "When in doubt, don't spawn" ตัวอย่าง: ${aggrAgents.slice(0, 8).map(a => a.name).join(', ')}`),
  T('Disable agents outside your stack, or the plugin for this project.', 'ปิด agent ที่ไม่ตรง stack หรือปิดทั้ง plugin ในโปรเจกต์นี้'))
// auto-action invitations: a description that triggers an outward action on completion instead of on request
const AUTO_ACTION = /(after|once|when) (finishing|completing|you finish|done|the change is)|automatically (deploy|push|commit|publish|release|merge)/i
for (const i of items.filter(i => !i.disabled && AUTO_ACTION.test(i.description) && /deploy|push|commit|publish|release|merge/i.test(i.description))) F('high', 'safety', 'CL-07',
  T(`${i.name} invites ${(i.description.match(/deploy|push|commit|publish|release|merge/i) || ['an action'])[0].toLowerCase()} without an explicit request`, `${i.name} ชวนให้ ${(i.description.match(/deploy|push|commit|publish|release|merge/i) || ['ทำ'])[0]} เองโดยไม่ได้ถูกสั่ง`),
  `${i.file}: "${i.description.slice(0, 220)}"`,
  T('Reword the trigger to "only when the user explicitly asks to …". See /context-doctor:secure.', 'แก้ trigger เป็น "only when the user explicitly asks to …" · ดู /context-doctor:secure'))
for (const m of mcp.filter(m => m.secrets.length)) F('high', 'safety', 'CL-10',
  T(`MCP "${m.name}" stores a secret in plaintext`, `MCP "${m.name}" เก็บ secret เป็น plaintext`),
  T(`${m.source}: ${m.secrets.join(', ')} written as literal values (settings files get synced, shared and backed up).`, `${m.source}: ${m.secrets.join(', ')} เขียนค่าตรงในไฟล์ (ไฟล์ settings อาจถูก sync/แชร์/backup)`),
  T('Use an environment variable reference (${VAR}) or a keychain, then rotate the value.', 'ย้ายไปเป็นตัวแปรแวดล้อม (${VAR}) หรือ keychain แล้วเปลี่ยนรหัสใหม่'))
const rewriteHooks = hooks.filter(h => h.event === 'PreToolUse' && /rtk|rewrite|dispatcher/i.test(h.command + h.description))
if (rewriteHooks.length) F('medium', 'transparency', 'CL-08',
  T(`${rewriteHooks.length} PreToolUse hook(s) rewrite or filter commands`, `มี ${rewriteHooks.length} PreToolUse hook ที่แก้/กรองคำสั่งก่อนรัน`),
  T('The model does not see the rewrite and may misread summarized output. ', 'โมเดลมองไม่เห็นว่าคำสั่งถูกเขียนใหม่ และอาจอ่านผลที่ถูกย่อผิด · ') + rewriteHooks.map(h => `${h.source}: ${h.id || h.command}`).join(' · '),
  T('Document each in CLAUDE.md with what to do (e.g. "rerun with `rtk proxy <cmd>` when output looks summarized"). See /context-doctor:annotate.', 'เขียนไว้ใน CLAUDE.md ว่าต้องทำอย่างไร (เช่น "ผลดูถูกย่อ ให้รันซ้ำด้วย `rtk proxy <cmd>`") · ดู /context-doctor:annotate'))
{
  const hit = (h, tool) => h.matcher === '*' || h.matcher === '.*' || h.matcher.split('|').includes(tool)
  const per = hooks.filter(h => (h.event === 'PreToolUse' || h.event === 'PostToolUse') && hit(h, 'Bash'))
  if (per.length >= 6) F('low', 'budget', 'CL-08', T(`Each Bash call runs ${per.length} hooks`, `Bash หนึ่งครั้งรัน hook ${per.length} ตัว`),
    per.map(h => `${h.event}: ${h.id || h.command}`).join(' · '), T('Remove hooks that duplicate each other (e.g. two status reporters).', 'ลบ hook ที่ทำงานซ้ำกัน (เช่นตัวรายงานสถานะสองตัว)'))
}
const orphan = plugins.reduce((a, p) => a + p.orphanedVersions, 0)
if (orphan > 3) F('low', 'budget', 'CL-13', T(`${orphan} stale plugin versions in the cache`, `มีเวอร์ชัน plugin ค้างในแคช ${orphan} ชุด`),
  plugins.filter(p => p.orphanedVersions).map(p => `${p.name}: ${p.orphanedVersions}`).join(' · '), T('Clean up via /plugin, or delete folders containing .orphaned_at under ~/.claude/plugins/cache.', 'ล้างผ่าน /plugin หรือลบโฟลเดอร์ที่มี .orphaned_at ใน ~/.claude/plugins/cache'))
if (duplicates.length) F('medium', 'routing', 'CL-12', T(`${duplicates.length} names exist in more than one source`, `มี ${duplicates.length} ชื่อซ้ำข้ามแหล่ง`),
  duplicates.slice(0, 12).map(d => `${d.name} ×${d.items.length}`).join(' · '), T('Keep one per job; turn the rest off with skillOverrides.', 'เก็บไว้ตัวเดียวต่องาน ที่เหลือปิดด้วย skillOverrides'))
{
  const hot = topics.filter(t => t.severity === 'high')
  if (hot.length) F('medium', 'routing', 'CL-05', T(`${hot.length} job${hot.length === 1 ? '' : 's'} with several competing owners`, `${hot.length} งานมีหลายตัวแย่งกันรับ`),
    hot.map(t => `${t.topic}: ${t.count} (${T('pressure', 'สั่งใช้ทันที')} ${t.aggressive.length})`).join(' · '),
    T('Pick one owner per job, write it in project CLAUDE.md (e.g. "code review → /code-review"), disable the rest. See /context-doctor:sharpen.', 'เลือกเจ้าของหนึ่งตัวต่องาน เขียนไว้ใน CLAUDE.md ของโปรเจกต์ ที่เหลือปิด · ดู /context-doctor:sharpen'))
}
{
  const thTok = Math.round(thaiCount(memText) * THAI_TOKENS_PER_CHAR)
  if (thTok > 3000) F('low', 'budget', 'CL-14', T(`Thai text in always-loaded memory ≈${n(thTok)} tokens`, `ข้อความไทยใน memory ≈${n(thTok)} tokens`),
    T('Thai costs ~3.5× more tokens per character than English (≈0.7 vs ≈2.5 chars/token).', 'ภาษาไทยกิน token ต่อตัวอักษรมากกว่าอังกฤษราว 3.5 เท่า (≈0.7 เทียบ ≈2.5 ตัวอักษร/token)'),
    T('Model-only notes (MEMORY.md index, hints) can be terse English; user-facing text stays as is.', 'โน้ตที่โมเดลอ่านอย่างเดียว (ดัชนี MEMORY.md, hints) เขียนเป็นอังกฤษสั้น ๆ ได้ ข้อความที่ผู้ใช้เห็นคงเดิม'))
}
for (const c of ruleConflicts) F('medium', 'consistency', 'CL-06', T(`Opposite rules on "${c.subject}" across ${c.sourceCount} sources`, `กฎขั้วตรงข้ามเรื่อง "${c.subject}" จาก ${c.sourceCount} แหล่ง`),
  c.pairs.map(p => `${p.always.map(r => `[${r.source}] ${r.text}`)[0]} ⇄ ${p.opposite.map(r => `[${r.source}] ${r.text}`)[0]}`).join(' | '),
  T(`Read both sides; if they apply to different actors it is not a conflict (scan.mjs --dismiss "${c.subject}::<source>"), otherwise run /context-doctor:harmonize.`, `อ่านทั้งสองฝั่ง ถ้าใช้กับคนละบทบาทก็ไม่ใช่การขัดกัน (scan.mjs --dismiss "${c.subject}::<source>") ถ้าขัดจริงให้รัน /context-doctor:harmonize`))

// secrets outside MCP config: hook commands, settings env, credentials written into memory
for (const h of hooks.filter(h => h.hasSecret)) F('high', 'safety', 'CL-10',
  T(`A ${h.event} hook command carries a credential`, `command ของ hook ${h.event} มี credential อยู่ในตัว`),
  T(`${h.source}${h.id ? ' · ' + h.id : ''}: the command line holds a literal token/password (shown redacted here).`, `${h.source}${h.id ? ' · ' + h.id : ''}: บรรทัดคำสั่งมี token/รหัสผ่านเป็นค่าตรง (ในรายงานนี้ปิดค่าไว้แล้ว)`),
  T('Read it from an environment variable or a file outside the settings, then rotate it.', 'ให้อ่านจากตัวแปรแวดล้อมหรือไฟล์นอก settings แล้วเปลี่ยนค่าใหม่'))
if (envSecrets.length) F('high', 'safety', 'CL-10',
  T(`${envSecrets.length} secret-like value(s) in settings env`, `มีค่าที่ดูเป็น secret ${envSecrets.length} ค่าใน env ของ settings`),
  envSecrets.map(e => `${e.file}: env.${e.key}`).join(' · '),
  T('Set them in your shell profile or a keychain instead of settings files, then rotate them.', 'ย้ายไปตั้งใน shell profile หรือ keychain แทนไฟล์ settings แล้วเปลี่ยนค่าใหม่'))
{
  const always = memoryCreds.filter(c => !c.lazy)
  if (always.length) F('medium', 'safety', 'CL-10',
    T(`${always.length} line(s) in always-loaded memory look like credentials`, `memory ที่โหลดทุกครั้งมี ${always.length} บรรทัดที่ดูเป็นรหัสผ่าน/credential`),
    always.slice(0, 10).map(c => `${c.file}:${c.line}`).join(' · '),
    T('Even demo passwords end up in every session and every shared transcript. Keep them in a .env or a skill the model loads only when testing, or confirm they are throwaway.', 'แม้เป็นรหัสของบัญชีทดสอบ ก็ถูกส่งไปทุก session และติดไปใน transcript ที่แชร์ ควรย้ายไป .env หรือ skill ที่โหลดเฉพาะตอนเทส หรือยืนยันว่าเป็นค่าทิ้งได้'))
}

// definition files Claude Code silently mis-loads
{
  const broken = items.filter(i => i.problems)
  if (broken.length) F('high', 'routing', 'CL-17',
    T(`${broken.length} skill/agent file(s) have frontmatter Claude Code cannot parse`, `ไฟล์ skill/agent ${broken.length} ไฟล์มี frontmatter ที่ Claude Code parse ไม่ผ่าน`),
    broken.slice(0, 10).map(i => `${i.file}:${i.problems[0].line} ${i.problems[0].problem}`).join(' · '),
    T('A skill whose YAML fails loses every field (name, description, allowed-tools, disable-model-invocation) without a warning. Fix the lines listed; `claude plugin validate <dir>` confirms.', 'skill ที่ YAML พังจะเสียทุกฟิลด์ (name, description, allowed-tools, disable-model-invocation) โดยไม่มีคำเตือน แก้บรรทัดที่ระบุ แล้วยืนยันด้วย `claude plugin validate <dir>`'))
  const noDescAgents = items.filter(i => i.kind === 'agent' && i.declaredName && !i.description && i.source !== SRC.plugin)
  if (noDescAgents.length) F('medium', 'routing', 'CL-17',
    T(`${noDescAgents.length} agent(s) have a name but no description, so they never load`, `agent ${noDescAgents.length} ตัวมี name แต่ไม่มี description จึงไม่ถูกโหลด`),
    noDescAgents.map(i => i.file).join(' · '), T('Add a description line to the frontmatter.', 'เพิ่มบรรทัด description ใน frontmatter'))
  const groups = {}
  for (const i of items.filter(i => i.kind === 'agent' && i.declaredName)) (groups[`${path.dirname(i.file)}::${i.declaredName}`] ||= []).push(i.file)
  const clashes = Object.entries(groups).filter(([, v]) => v.length > 1)
  if (clashes.length) F('medium', 'routing', 'CL-17',
    T(`${clashes.length} agent name(s) defined twice in the same folder`, `ชื่อ agent ${clashes.length} ชื่อถูกประกาศซ้ำในโฟลเดอร์เดียวกัน`),
    clashes.map(([k, v]) => `${k.split('::')[1]}: ${v.join(', ')}`).join(' · '),
    T('Only one loads, and which one depends on directory order — it can differ between machines. Rename or remove the extras.', 'จะโหลดได้ตัวเดียว และตัวไหนขึ้นกับลำดับไฟล์ในโฟลเดอร์ ซึ่งต่างกันได้ในแต่ละเครื่อง ให้เปลี่ยนชื่อหรือลบตัวที่เกิน'))
}

// guidance in personal memory that a checked-in file already says
const norm = l => l.toLowerCase().replace(/[`*_>#|[\]().,:;!?"'-]/g, ' ').replace(/\s+/g, ' ').trim()
const localDuplicates = []
{
  const linesOf = m => (readText(untilde(m.file)) || '').split('\n').map((t, i) => ({ t: norm(t), line: i + 1, raw: t })).filter(x => x.t.split(' ').length >= 5)
  const checked = alwaysMemory.filter(isCheckedIn).flatMap(m => linesOf(m).map(x => ({ ...x, file: m.file })))
  for (const m of alwaysMemory.filter(isLocalMemory)) for (const x of linesOf(m)) {
    const A = new Set(x.t.split(' '))
    const hit = checked.find(c => c.t === x.t || (() => { const B = new Set(c.t.split(' ')); const inter = [...A].filter(w => B.has(w)).length; return inter / (A.size + B.size - inter) >= 0.8 })())
    if (hit) localDuplicates.push({ local: `${m.file}:${x.line}`, checked: `${hit.file}:${hit.line}`, text: redact(redactProse(x.raw.trim())).slice(0, 160) })
  }
  if (localDuplicates.length) F('low', 'budget', 'CL-12',
    T(`${localDuplicates.length} line(s) in personal memory repeat a checked-in file`, `memory ส่วนตัวมี ${localDuplicates.length} บรรทัดที่ซ้ำกับไฟล์ที่ commit ไว้`),
    localDuplicates.slice(0, 8).map(d => `${d.local} = ${d.checked}`).join(' · '),
    T('Delete the copy from the personal file (~/.claude/CLAUDE.md or CLAUDE.local.md); the checked-in one already loads. See /context-doctor:harmonize.', 'ลบบรรทัดที่ซ้ำออกจากไฟล์ส่วนตัว (~/.claude/CLAUDE.md หรือ CLAUDE.local.md) เพราะไฟล์ที่ commit ไว้โหลดอยู่แล้ว · ดู /context-doctor:harmonize'))
}

// from --usage: MCP servers never called, slow or timing-out hooks, denied tool calls
const usageData = readState('usage.json')
if (usageData && usageData.files >= 5) {
  const calls = new Map(usageData.mcp || [])
  const idle = mcp.filter(m => !m.disabled && !calls.get(m.key))
  if (idle.length) F('low', 'budget', 'CL-13',
    T(`${idle.length} MCP server(s) never called in ${usageData.files} transcripts`, `MCP ${idle.length} ตัวไม่เคยถูกเรียกใน transcript ${usageData.files} ไฟล์`),
    idle.map(m => `${m.name} (${m.source})`).join(' · '),
    T('Their tool schemas are usually deferred, so this is not about tokens: each one is still a connection to keep authenticated and updated, and its instructions sit in the system prompt. Disable the ones you do not use (/mcp disable <name>, per project).', 'tool schema ของ MCP ส่วนใหญ่ถูกเลื่อนโหลดอยู่แล้ว เรื่องนี้จึงไม่ได้เกี่ยวกับ token แต่ทุกตัวยังเป็นการเชื่อมต่อที่ต้องดูแลเรื่องสิทธิ์และอัปเดต และคำสั่งของมันอยู่ใน system prompt ตัวไหนไม่ใช้ให้ปิด (/mcp disable <name> ทีละโปรเจกต์)'))
  const slow = (usageData.hooks || []).filter(h => h.timeouts > 0 || h.avgMs > 1500)
  if (slow.length) F(slow.some(h => h.timeouts >= 3) ? 'medium' : 'low', 'budget', 'CL-18',
    T(`${slow.length} hook(s) are slow or time out`, `hook ${slow.length} ตัวช้าหรือหมดเวลา`),
    slow.slice(0, 6).map(h => `${h.event} ${h.command}: ${h.runs}× avg ${n(h.avgMs)}ms${h.timeouts ? `, ${h.timeouts} ${T('timeouts', 'ครั้งหมดเวลา')}` : ''}`).join(' · '),
    T('Every matching tool call waits for these. Remove the hook, narrow its matcher, or raise its timeout if it must finish.', 'ทุก tool call ที่ตรง matcher ต้องรอ hook เหล่านี้ ให้ลบ hook จำกัด matcher ให้แคบลง หรือเพิ่ม timeout ถ้ามันต้องทำงานให้เสร็จ'))
  const den = usageData.denials || []
  const total = den.reduce((a, d) => a + d.n, 0)
  if (total >= 10) F('low', 'transparency', 'CL-08',
    T(`${total} tool calls were denied in ${usageData.files} transcripts`, `tool call ถูกปฏิเสธ ${total} ครั้งใน transcript ${usageData.files} ไฟล์`),
    den.slice(0, 6).map(d => `${d.tool} · ${d.kind}: ${d.n}`).join(' · '),
    T('"permission-rule" denials that keep repeating on read-only commands are worth an allow rule (/fewer-permission-prompts); denials from hooks should be documented (/context-doctor:annotate).', 'การปฏิเสธแบบ "permission-rule" ที่เกิดซ้ำกับคำสั่งอ่านอย่างเดียว ควรเพิ่ม allow rule (/fewer-permission-prompts) ส่วนที่มาจาก hook ควรเขียนบอกไว้ (/context-doctor:annotate)'))
}

// Hand-verified checks: scanner/rules.json (shipped) + ~/.claude/context-doctor/curated.json (yours). Shown while their condition holds.
const pickLang = v => (v && typeof v === 'object' ? v[LANG] ?? v.en : v)
for (const c of [...(readJson(path.join(HERE, 'rules.json')) || []), ...(readJson(path.join(OUT, 'curated.json')) || [])]) {
  const q = c.requires || {}
  const ok = (!q.item || items.some(i => i.name === q.item && !i.disabled))
    && (!q.itemDescIncludes || items.some(i => i.name === q.itemDescIncludes.name && !i.disabled && i.description.includes(q.itemDescIncludes.text)))
    && (!q.memoryText || memText.includes(q.memoryText))
    && (!q.memoryFile || memory.some(m => m.file.endsWith(q.memoryFile)))
    && (!q.hookCommand || hooks.some(h => h.command.includes(q.hookCommand)))
    && (!q.hookId || hooks.some(h => h.id === q.hookId))
    && (!q.notMemoryText || !memText.includes(q.notMemoryText))
  if (ok) findings.push({ severity: c.severity, cat: c.cat, code: c.code, title: pickLang(c.title), detail: pickLang(c.detail), fix: pickLang(c.fix), verified: true })
}
findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (b.verified ? 1 : 0) - (a.verified ? 1 : 0))

// ---------- automatic score (estimate) — /context-doctor:audit writes verified scores to audit.json ----------
const BEHAVIOR_HOOK = /rtk|dispatcher|format|protection|gateguard|session:start|fact-force|inject/i
const behaviorHooks = hooks.filter(h => BEHAVIOR_HOOK.test(`${h.id} ${h.command}`))
const isDocumented = h => (h.id && memText.includes(h.id)) || (/rtk/.test(h.command) && /rtk proxy/.test(memText))
const clamp = x => Math.max(0, Math.min(4, x))
const catCount = (cat, sev) => findings.filter(f => f.cat === cat && (!sev || f.severity === sev)).length
const hotTopics = topics.filter(t => t.severity === 'high').length
const autoScores = {
  budget: clamp(4 - (alwaysTokens > 15000 ? 2 : alwaysTokens > 8000 ? 1 : 0) - (listingTokensIfFull > LISTING_BUDGET * 2 ? 2 : listingTokensIfFull > LISTING_BUDGET ? 1 : 0)),
  routing: clamp((hotTopics === 0 ? 4 : hotTopics <= 2 ? 3 : hotTopics <= 4 ? 2 : hotTopics <= 6 ? 1 : 0) - (aggrAgents.length > 10 ? 1 : 0)),
  consistency: clamp(4 - Math.min(2, Math.ceil(ruleConflicts.length / 4)) - findings.filter(f => f.verified && f.cat === 'consistency').length),
  transparency: clamp(4 - Math.ceil(behaviorHooks.filter(h => !isDocumented(h)).length / 2)),
  safety: clamp(4 - 2 * Math.min(1, catCount('safety', 'high')) - Math.max(0, catCount('safety', 'high') - 1)),
}
const audit = readState('audit.json')

const report = {
  tool: 'context-doctor', lang: LANG, generatedAt: new Date().toISOString(), project: tilde(PROJECT),
  autoScores, audit: audit && audit.project === tilde(PROJECT) ? audit : null,
  listingBudget: LISTING_BUDGET, contextWindow: CONTEXT_WINDOW, contextWindowFrom: CONTEXT_WINDOW_FROM, stateDir: tilde(PDIR),
  usage: usageData ? { generatedAt: usageData.generatedAt, files: usageData.files, byPlugin: usageData.byPlugin, used: usageData.used, mcp: usageData.mcp, hooks: usageData.hooks, denials: usageData.denials } : null,
  systemPromptTokens: promptText ? tokens(promptText) : null, systemPromptCapturedAt: promptCapturedAt,
  behaviorHooks: behaviorHooks.map(h => ({ ...h, documented: isDocumented(h) })),
  stats: {
    memoryFiles: alwaysMemory.length, lazyMemoryFiles: memory.length - alwaysMemory.length, alwaysTokens, skills: items.filter(i => i.kind === 'skill').length,
    commands: items.filter(i => i.kind === 'command').length, agents: items.filter(i => i.kind === 'agent').length,
    plugins: plugins.filter(p => p.enabled).length, pluginsInstalled: plugins.length, hooks: hooks.length, mcp: mcp.length,
    rules: allRules.length, listingTokensIfFull, noDescription: noDesc.length,
  },
  memory, settings: settingsFiles.map(s => ({ scope: s.scope, file: tilde(s.file), keys: Object.keys(s.json), skillOverrides: s.json.skillOverrides || null, env: s.json.env ? Object.keys(s.json.env) : null })),
  plugins, items, hooks, mcp, topics, duplicates, localDuplicates, ruleConflicts, harnessRules, findings, noDescription: noDesc,
  memoryCredentials: memoryCreds,
}

// ---------- diff against the previous scan ----------
function diffReports(prev, cur) {
  if (!prev || prev.project !== cur.project || prev.tool !== 'context-doctor') return null
  const cmp = (label, a, b, key) => {
    const A = new Set((a || []).map(key)), B = new Set((b || []).map(key))
    return { label, added: [...B].filter(k => !A.has(k)), removed: [...A].filter(k => !B.has(k)) }
  }
  const sections = [
    cmp('plugins', prev.plugins.filter(p => p.enabled), cur.plugins.filter(p => p.enabled), p => `${p.id}@${p.version}`),
    cmp('skills/commands', prev.items.filter(i => i.kind !== 'agent'), cur.items.filter(i => i.kind !== 'agent'), i => i.name),
    cmp('agents', prev.items.filter(i => i.kind === 'agent'), cur.items.filter(i => i.kind === 'agent'), i => i.name),
    cmp('hooks', prev.hooks, cur.hooks, h => `${h.event} [${h.matcher}] ${h.id || h.command} (${h.source})`),
    cmp('MCP', prev.mcp, cur.mcp, m => `${m.name} (${m.source})`),
    cmp('memory', prev.memory, cur.memory, m => m.file),
  ].filter(d => d.added.length || d.removed.length)
  const changedMemory = cur.memory.map(m => [m, prev.memory.find(p => p.file === m.file)]).filter(([m, p]) => p && Math.abs(m.tokens - p.tokens) > Math.max(50, p.tokens * 0.05)).map(([m, p]) => ({ file: m.file, from: p.tokens, to: m.tokens }))
  const changedDesc = cur.items.map(i => [i, prev.items.find(p => p.name === i.name && p.kind === i.kind)]).filter(([i, p]) => p && p.description !== i.description).map(([i]) => `${i.name} (${i.kind})`)
  return { since: prev.generatedAt, sections, changedMemory, changedDesc, isEmpty: !sections.length && !changedMemory.length && !changedDesc.length }
}
// the per-project copy keeps each project's history; OUT/report.{json,html} is always the latest scan
report.diff = diffReports(readState('report.json'), report)
const tpl = readText(path.join(HERE, 'template.html'))
const html = tpl ? tpl.replace('/*__DATA__*/null', JSON.stringify(report).replace(/</g, '\\u003c')) : null
for (const dir of [PDIR, OUT]) {
  writeJson(path.join(dir, 'report.json'), report)
  if (html) fs.writeFileSync(path.join(dir, 'report.html'), html)
}

const print = text => new Promise(r => process.stdout.write(text + '\n', r))
const typeLabel = t => ({ never: T('never', 'ห้าม'), must: T('must', 'ต้องทำ'), trigger: T('trigger', 'ทริกเกอร์') }[t])
const sevLabel = s => ({ high: T('high', 'สูง'), medium: T('medium', 'กลาง'), low: T('low', 'ต่ำ') }[s])
const when = t => new Date(t).toLocaleString(LOCALE)

if (args.includes('--json')) {
  await print(JSON.stringify(report))
} else if (args.includes('--find')) {
  const q = new RegExp(argVal('--find', ''), 'i')
  const hitsR = allRules.filter(r => q.test(r.text))
  const hitsD = items.filter(i => !i.disabled && q.test(i.description))
  const hitsH = hooks.filter(h => q.test(`${h.id} ${h.description} ${h.command}`))
  await print([`# ${T('Search', 'ค้น')} /${q.source}/`, '',
    `## ${T('Rules', 'กฎ')} (${hitsR.length})`, ...hitsR.slice(0, 80).map(r => `- [${typeLabel(r.type)}] ${r.text}  — ${r.source}${r.line ? ':' + r.line : ''}${alwaysSources.has(r.source) ? T(' (always loaded)', ' (โหลดทุกครั้ง)') : ''}`),
    '', `## Descriptions (${hitsD.length})`, ...hitsD.slice(0, 60).map(i => `- ${i.name} (${i.kind}${i.aggressive ? T(', pressure wording', ', สั่งให้ใช้ทันที') : ''}): ${i.description.slice(0, 220)}`),
    '', `## Hooks (${hitsH.length})`, ...hitsH.map(h => `- ${h.event} [${h.matcher}] ${h.id || h.command} — ${h.source}`)].join('\n'))
} else if (args.includes('--plugins')) {
  const set = f => readJson(path.join(PROJECT, f))?.enabledPlugins || {}
  const proj = { ...set('.claude/settings.json'), ...set('.claude/settings.local.json') }
  await print(JSON.stringify(plugins.map(p => ({
    id: p.id, name: p.name, enabled: p.enabled, isToggleable: p.scope !== SRC.sync, isProjectOverride: p.id in proj,
    skills: p.counts.skill ?? 0, commands: p.counts.command ?? 0, agents: p.counts.agent ?? 0, hooks: p.counts.hooks ?? 0,
    listingTokens: listingTokens(items.filter(i => i.plugin === p.name)),
  }))))
} else if (args.includes('--diff')) {
  const d = report.diff
  const L = [`# ${T('Changes since the previous scan', 'สิ่งที่เปลี่ยนตั้งแต่สแกนครั้งก่อน')}`, '']
  if (!d) L.push(T('No previous scan of this project yet; the next run compares against this one.', 'ยังไม่มีการสแกนครั้งก่อนของโปรเจกต์นี้ ครั้งหน้าจะเทียบกับรอบนี้'))
  else if (d.isEmpty) L.push(T(`Nothing changed since ${when(d.since)}`, `ไม่มีอะไรเปลี่ยนตั้งแต่ ${when(d.since)}`))
  else {
    L.push(T(`Compared with ${when(d.since)}`, `เทียบกับ ${when(d.since)}`), '')
    for (const s of d.sections) {
      L.push(`## ${s.label}`, ...s.added.slice(0, 40).map(a => `- ➕ ${a}`), ...s.removed.slice(0, 40).map(r => `- ➖ ${r}`))
      if (s.added.length > 40 || s.removed.length > 40) L.push(`- … ${T('more', 'อีก')} ${Math.max(0, s.added.length - 40) + Math.max(0, s.removed.length - 40)}`)
      L.push('')
    }
    if (d.changedMemory.length) L.push(`## ${T('Memory size changed', 'memory ที่ขนาดเปลี่ยน')}`, ...d.changedMemory.map(m => `- ${m.file}: ${n(m.from)} → ${n(m.to)} tokens`), '')
    if (d.changedDesc.length) L.push(`## ${T('Edited descriptions', 'description ที่ถูกแก้')}`, ...d.changedDesc.slice(0, 40).map(x => `- ${x}`))
  }
  await print(L.join('\n'))
  process.exitCode = d && !d.isEmpty && args.includes('--exit-code') ? 3 : 0
} else if (args.includes('--usage')) {
  // Real use, from two local sources (nothing leaves the machine):
  //  - transcripts under ~/.claude/projects: window evidence (Skill/Agent/MCP tool calls, typed commands, hook runs, denials)
  //  - ~/.claude.json skillUsage / pluginUsage: lifetime totals since install, all projects together
  // Transcript content is untrusted: it is only counted, never followed or echoed.
  const all = args.includes('--all-projects')
  const dirs = all ? ls(path.join(CLAUDE, 'projects')).map(d => path.join(CLAUDE, 'projects', d)) : [path.join(CLAUDE, 'projects', projectSlug(PROJECT))]
  const use = { skill: new Map(), agent: new Map(), command: new Map(), mcp: new Map() }
  const bump = (m, k, t) => { const v = m.get(k) || { n: 0, last: 0 }; v.n++; v.last = Math.max(v.last, t); m.set(k, v) }
  const hookRuns = new Map(), denials = new Map()
  let files = 0, oldest = Infinity
  const SAFE = /^[\w.:@/-]{1,120}$/ // names we are willing to count; anything else is ignored
  for (const d of dirs) for (const f of ls(d).filter(x => x.endsWith('.jsonl'))) {
    const p = path.join(d, f), st = fs.statSync(p), text = readText(p) || ''
    files++; oldest = Math.min(oldest, st.birthtimeMs || st.mtimeMs)
    const toolNames = new Map()
    for (const line of text.split('\n')) {
      if (!line.includes('"tool_use"') && !line.includes('<command-name>') && !line.includes('"hook_') && !line.includes('toolDenialKind')) continue
      let o
      try { o = JSON.parse(line) } catch { continue }
      const t = Date.parse(o.timestamp) || st.mtimeMs
      const content = Array.isArray(o.message?.content) ? o.message.content : []
      for (const c of content) {
        if (c?.type !== 'tool_use' || typeof c.name !== 'string') continue
        toolNames.set(c.id, c.name)
        const input = c.input || {}
        if (c.name === 'Skill' && SAFE.test(input.skill || '')) bump(use.skill, input.skill.replace(/^\//, ''), t)
        else if ((c.name === 'Agent' || c.name === 'Task')) bump(use.agent, SAFE.test(input.subagent_type || '') ? input.subagent_type : 'general-purpose', t)
        else if (c.name.startsWith('mcp__')) { const server = c.name.split('__')[1]; if (SAFE.test(server)) bump(use.mcp, server, t) }
      }
      if (o.type === 'user') {
        const body = typeof o.message?.content === 'string' ? o.message.content : content.map(c => typeof c?.text === 'string' ? c.text : typeof c?.content === 'string' ? c.content : '').join('\n')
        for (const m of body.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) if (SAFE.test(m[1])) bump(use.command, m[1], t)
      }
      if (o.toolDenialKind && SAFE.test(o.toolDenialKind)) {
        const id = content.find(c => c?.tool_use_id)?.tool_use_id
        const tool = toolNames.get(id) || '?'
        const k = `${tool}\u0000${o.toolDenialKind}`
        denials.set(k, (denials.get(k) || 0) + 1)
      }
      const a = o.type === 'attachment' ? o.attachment : null
      if (a && /^hook_/.test(a.type || '') && typeof a.hookEvent === 'string') {
        const k = `${a.hookEvent}\u0000${summarizeCmd(String(a.command || a.hookName || ''))}`
        const h = hookRuns.get(k) || { runs: 0, ms: 0, timed: 0, maxMs: 0, timeouts: 0, errors: 0, cancelled: 0 }
        if (['hook_success', 'hook_non_blocking_error', 'hook_error_during_execution', 'hook_cancelled'].includes(a.type)) h.runs++
        if (typeof a.durationMs === 'number') { h.ms += a.durationMs; h.timed++; h.maxMs = Math.max(h.maxMs, a.durationMs) }
        if (a.type === 'hook_cancelled') { if (a.timedOut) h.timeouts++; else h.cancelled++ }
        if (a.type === 'hook_non_blocking_error' || a.type === 'hook_error_during_execution') h.errors++
        hookRuns.set(k, h)
      }
    }
  }
  // lifetime counters — skill names may be stored qualified (dir:name) or bare
  const skillLife = claudeJson.skillUsage || {}, pluginLife = claudeJson.pluginUsage || {}
  const lifeOf = i => Math.max(skillLife[i.name]?.usageCount || 0, skillLife[i.short]?.usageCount || 0)
  // exact full names only: a plugin item "x:plan" is not the built-in "/plan"
  const usedNames = new Set([...use.skill.keys(), ...use.command.keys(), ...use.agent.keys()])
  const byPlugin = {}
  for (const i of items.filter(i => !i.disabled)) {
    const key = i.plugin || i.source
    const b = (byPlugin[key] ||= { total: 0, used: 0, unusedTokens: 0, lifetime: 0 })
    b.total++
    if (!i.plugin) b.lifetime += lifeOf(i)
    if (usedNames.has(i.name)) b.used++
    else if (i.kind !== 'agent') b.unusedTokens += i.descTokens + tokens(i.name) + 2
  }
  // pluginUsage is seeded at install/enable: only a count above 0 is evidence
  for (const p of plugins.filter(p => p.enabled)) {
    const b = (byPlugin[p.name] ||= { total: 0, used: 0, unusedTokens: 0, lifetime: 0 })
    b.lifetime = pluginLife[p.id]?.usageCount || 0
    // a plugin with nothing invocable but a counter above zero delivers through LSP (or another counted channel)
    b.signal = p.signal === 'none' && b.lifetime > 0 ? 'lsp' : p.signal
  }
  const hooksOut = [...hookRuns.entries()].map(([k, h]) => { const [event, command] = k.split('\u0000'); return { event, command, runs: h.runs, avgMs: h.timed ? Math.round(h.ms / h.timed) : 0, maxMs: h.maxMs, timeouts: h.timeouts, errors: h.errors, cancelled: h.cancelled } })
    .sort((a, b) => b.timeouts - a.timeouts || b.avgMs * b.runs - a.avgMs * a.runs)
  const denialsOut = [...denials.entries()].map(([k, n]) => { const [tool, kind] = k.split('\u0000'); return { tool, kind, n } }).sort((a, b) => b.n - a.n)
  const top = (m, k = 15) => [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, k)
  const day = t => new Date(t).toLocaleDateString(LOCALE)
  const times = T('×', 'ครั้ง')
  writeJson(path.join(PDIR, 'usage.json'), {
    generatedAt: new Date().toISOString(), project: tilde(PROJECT), all, files, byPlugin, used: [...usedNames],
    skill: [...use.skill], agent: [...use.agent], command: [...use.command], mcp: [...use.mcp].map(([k, v]) => [k, v.n]),
    hooks: hooksOut, denials: denialsOut,
    lifetime: Object.fromEntries(items.filter(i => !i.disabled && i.kind !== 'agent').map(i => [i.name, lifeOf(i)]).filter(([, v]) => v > 0)),
  })
  const signalNote = s => s === 'none' ? T(' (no usage signal: ask)', ' (ไม่มีสัญญาณการใช้งาน: ต้องถามผู้ใช้)') : s === 'lsp' ? T(' (LSP: counter only)', ' (LSP: ดูได้จากตัวนับเท่านั้น)') : ''
  const knownMcp = new Set(mcp.map(m => m.key))
  const otherMcp = [...use.mcp].filter(([k]) => !knownMcp.has(k)).sort((a, b) => b[1].n - a[1].n)
  const mcpRows = mcp.filter(m => !m.disabled).map(m => [m, use.mcp.get(m.key)]).sort((a, b) => (b[1]?.n || 0) - (a[1]?.n || 0))
  await print([
    `# ${T('Real usage', 'การใช้งานจริง')} ${all ? T('(all projects)', '(ทุกโปรเจกต์)') : T('(this project)', '(โปรเจกต์นี้)')}`, '',
    T(`From ${files} transcripts since ${isFinite(oldest) ? day(oldest) : '-'}. "lifetime" = Claude Code's own counter since install, all projects.`, `จาก transcript ${files} ไฟล์ ตั้งแต่ ${isFinite(oldest) ? day(oldest) : '-'} · "สะสม" = ตัวนับของ Claude Code เองตั้งแต่ติดตั้ง รวมทุกโปรเจกต์`), '',
    `## ${T('Used per source', 'แต่ละแหล่งถูกใช้จริงกี่ตัว')}`, '', `| ${T('source', 'แหล่ง')} | ${T('used / total', 'ใช้แล้ว / ทั้งหมด')} | ${T('lifetime uses', 'ใช้สะสม')} | ${T('unused listing (≈tok)', 'listing ที่ไม่เคยใช้ (≈tok)')} |`, '|---|---:|---:|---:|',
    ...Object.entries(byPlugin).sort((a, b) => b[1].unusedTokens - a[1].unusedTokens).map(([k, b]) => `| ${k}${signalNote(b.signal)} | ${b.used} / ${b.total} | ${n(b.lifetime)} | ${n(b.unusedTokens)} |`), '',
    `## ${T('Skills invoked', 'Skills ที่ถูกเรียก')}`, '', ...(use.skill.size ? top(use.skill).map(([k, v]) => `- ${k} — ${v.n} ${times} · ${day(v.last)}`) : ['-']), '',
    `## ${T('Agents spawned', 'Agents ที่ถูก spawn')}`, '', ...(use.agent.size ? top(use.agent).map(([k, v]) => `- ${k} — ${v.n} ${times} · ${day(v.last)}`) : ['-']), '',
    `## ${T('Slash commands typed', 'Slash commands ที่พิมพ์')}`, '', ...(use.command.size ? top(use.command, 20).map(([k, v]) => `- /${k} — ${v.n} ${times}`) : ['-']), '',
    `## ${T('MCP servers', 'MCP servers')}`, '', ...(mcpRows.length ? mcpRows.map(([m, v]) => `- ${m.name} (${m.source}) — ${v ? `${v.n} ${times} · ${day(v.last)}` : T('never called', 'ไม่เคยถูกเรียก')}`) : ['-']),
    ...(otherMcp.length ? [T(`- built-in / not in config: ${otherMcp.map(([k, v]) => `${k} ${v.n}`).join(', ')}`, `- ในตัว / ไม่อยู่ใน config: ${otherMcp.map(([k, v]) => `${k} ${v.n}`).join(', ')}`)] : []), '',
    `## ${T('Hooks: time and failures', 'Hooks: เวลาและความล้มเหลว')}`, '', ...(hooksOut.length ? hooksOut.slice(0, 12).map(h => `- ${h.event} ${h.command} — ${h.runs} ${times} · avg ${n(h.avgMs)}ms · max ${n(h.maxMs)}ms${h.timeouts ? ` · ⚠ ${h.timeouts} ${T('timeouts', 'ครั้งหมดเวลา')}` : ''}${h.errors ? ` · ${h.errors} ${T('errors', 'error')}` : ''}`) : ['-']), '',
    `## ${T('Denied tool calls', 'Tool call ที่ถูกปฏิเสธ')}`, '', ...(denialsOut.length ? denialsOut.slice(0, 12).map(d => `- ${d.tool} · ${d.kind} — ${d.n} ${times}`) : ['-']),
  ].join('\n'))
} else {
  const s = report.stats
  await print([
    `# Context Doctor — ${report.project}`, '',
    `| ${T('source', 'แหล่ง')} | ${T('count', 'จำนวน')} |`, '|---|---:|',
    `| ${T('always-loaded memory', 'memory ที่โหลดทุกครั้ง')} | ${s.memoryFiles} ${T('files', 'ไฟล์')} ≈ ${n(s.alwaysTokens)} tokens${s.lazyMemoryFiles ? T(` (+${s.lazyMemoryFiles} path-scoped rules)`, ` (+rules ตาม path ${s.lazyMemoryFiles} ไฟล์)`) : ''} |`,
    `| ${T('skill listing', 'รายการ skill')} | ≈${n(s.listingTokensIfFull)} / ${n(report.listingBudget)} tokens ${T('budget', 'งบ')} |`,
    `| skills / commands / agents | ${s.skills} / ${s.commands} / ${s.agents} |`,
    `| ${T('plugins enabled', 'plugins เปิดอยู่')} | ${s.plugins} / ${s.pluginsInstalled} |`,
    `| hooks / MCP servers | ${s.hooks} / ${s.mcp} |`,
    `| ${T('rules extracted', 'กฎที่สกัดได้')} | ${n(s.rules)} |`, '',
    `## ${T('Findings', 'ปัญหาที่เจอ')} (${findings.length})`,
    ...findings.slice(0, 12).map(f => `- **[${sevLabel(f.severity)}${f.code ? ' · ' + f.code : ''}] ${f.title}** — ${f.fix}`), '',
    `${T('Full report', 'รายงานเต็ม')}: file://${path.join(OUT, 'report.html')}`,
  ].join('\n'))
}
