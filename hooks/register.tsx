import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ContextInfo, Doc, LiveEvent, PluginRow, PromptInfo, View } from '../types'

const PANE = 'context-doctor'
const TITLE = 'Context Doctor'

// UI text in the user's language (settings.language → `scan.mjs --print-lang`)
const STRINGS = {
  en: {
    views: {
      summary: ['Summary', 'Scan Claude Code context (memory, skills, agents, hooks, MCP) and show findings in a side pane'],
      prompt: ['Real prompt', 'Show the system prompt sections and CLAUDE.md blocks actually sent to the model, with sizes'],
      live: ['Live', 'Watch which skills, agents and MCP tools each turn uses, and what hooks inject or deny'],
      usage: ['Usage', 'Count from transcripts which skills/agents/commands are really used, and which plugins never are'],
      diff: ['Changes', 'What was added, removed or edited in the context since the previous scan'],
      plugins: ['Plugins', 'Turn plugins on/off for this project, with the listing tokens each one costs'],
    },
    opened: (l: string) => `Context Doctor: ${l} — see the side pane`,
    changed: 'Context Doctor: your context changed since the last scan · /context-doctor-diff',
    reload: 'Reload', loading: 'Loading…', openHtml: 'Open HTML report', pressReload: 'Press "Reload"',
    scanFailed: (c: number) => `Scan failed (exit ${c})`, toggleFailed: (n: string, e: string) => `Could not change ${n}: ${e}`,
    toggled: (n: string, on: boolean) => `${n} → ${on ? 'on' : 'off'} in .claude/settings.local.json (personal) · applies to the next session`,
    composing: 'Composing prompt…', scopes: 'S = shared across users (cacheable) · P = this session only', openPrompt: 'Open the full prompt file',
    firstMsg: 'First message (CLAUDE.md, email, date)', notCaptured: 'Not captured yet: this block is sent once per conversation; it shows after the next /clear or compaction (the Summary tab reads the files directly).',
    liveHead: (t: number, n: number) => `turn ${t} · tool calls this turn ${n} · HOOK→ = text a hook injected for the model`, noEvents: 'No events yet; recording starts when the plugin loads.',
    pluginsHead: 'Writes .claude/settings.local.json (personal, not shared with the team) · applies next session · numbers = skill/cmd/agent/hook · ≈listing tokens',
    on: 'On', off: 'Off', projectSet: '  (set in project)', promptTitle: 'System prompt Claude Code composed for this session', blocksTitle: 'Context blocks in the first message',
  },
  th: {
    views: {
      summary: ['สรุป', 'สแกน context (memory, skills, agents, hooks, MCP) แล้วแสดงปัญหาในแผงข้างแชท'],
      prompt: ['Prompt จริง', 'ดู system prompt และบล็อก CLAUDE.md ที่ส่งให้โมเดลจริง ทีละ section พร้อมขนาด'],
      live: ['Live', 'ดูสดว่าแต่ละ turn เรียก skill/agent/MCP ไหน และ hook ฉีดข้อความหรือ deny อะไร'],
      usage: ['การใช้งาน', 'นับจาก transcript ว่า skill/agent/command ไหนถูกใช้จริง และ plugin ไหนไม่เคยถูกใช้'],
      diff: ['เปลี่ยนแปลง', 'สิ่งที่เพิ่ม/ลบ/แก้ใน context ตั้งแต่สแกนครั้งก่อน'],
      plugins: ['Plugins', 'เปิด/ปิด plugin ในโปรเจกต์นี้ พร้อม token ของ listing ที่แต่ละตัวใช้'],
    },
    opened: (l: string) => `Context Doctor: ${l} — ดูในแผงข้างแชท`,
    changed: 'Context Doctor: context เปลี่ยนตั้งแต่สแกนครั้งก่อน · /context-doctor-diff',
    reload: 'โหลดใหม่', loading: 'กำลังโหลด…', openHtml: 'เปิดรายงาน HTML', pressReload: 'กด "โหลดใหม่"',
    scanFailed: (c: number) => `สแกนไม่สำเร็จ (exit ${c})`, toggleFailed: (n: string, e: string) => `เปลี่ยน ${n} ไม่สำเร็จ: ${e}`,
    toggled: (n: string, on: boolean) => `${n} → ${on ? 'เปิด' : 'ปิด'} ใน .claude/settings.local.json (ของคุณคนเดียว) · มีผลเมื่อเริ่ม session ใหม่`,
    composing: 'กำลังประกอบ prompt…', scopes: 'S = ส่วนที่ทุกคนใช้ร่วมกัน (cache ได้) · P = ส่วนเฉพาะ session นี้', openPrompt: 'เปิดไฟล์ prompt เต็ม',
    firstMsg: 'ข้อความแรก (CLAUDE.md, email, วันที่)', notCaptured: 'ยังไม่ได้จับ: บล็อกนี้ส่งครั้งเดียวต่อบทสนทนา จะเห็นหลัง /clear หรือ compact ครั้งถัดไป (แท็บสรุปอ่านจากไฟล์ได้อยู่แล้ว)',
    liveHead: (t: number, n: number) => `turn ${t} · tool calls ใน turn นี้ ${n} · HOOK→ = ข้อความที่ hook ฉีดให้โมเดลอ่าน`, noEvents: 'ยังไม่มีเหตุการณ์ จะเริ่มบันทึกตั้งแต่ plugin โหลด',
    pluginsHead: 'เขียนลง .claude/settings.local.json (ของคุณคนเดียว ไม่แชร์ให้ทีม) · มีผลเมื่อเริ่ม session ใหม่ · ตัวเลข = skill/cmd/agent/hook · ≈token ของ listing',
    on: 'เปิด', off: 'ปิด', projectSet: '  (ตั้งในโปรเจกต์)', promptTitle: 'System prompt ที่ Claude Code ประกอบให้ session นี้', blocksTitle: 'Context blocks ในข้อความแรก',
  },
}
type Lang = keyof typeof STRINGS

const VIEWS: { view: View; command: string }[] = [
  { view: 'summary', command: 'context-doctor' },
  { view: 'prompt', command: 'context-doctor-prompt' },
  { view: 'live', command: 'context-doctor-live' },
  { view: 'usage', command: 'context-doctor-usage' },
  { view: 'diff', command: 'context-doctor-diff' },
  { view: 'plugins', command: 'context-doctor-plugins' },
]

const view = atom({ plugin: 'context-doctor', key: 'view' } as const, 'summary')
const docs = atom({ plugin: 'context-doctor', key: 'docs' } as const, {}, { shape: 'docs-1' })
const plugins = atom({ plugin: 'context-doctor', key: 'plugins' } as const, null, { shape: 'plugins-1' })
const live = atom({ plugin: 'context-doctor', key: 'live' } as const, [], { shape: 'live-1' })
const turns = atom({ plugin: 'context-doctor', key: 'turns' } as const, { turn: 0, tools: 0 }, { shape: 'turns-1' })
const prompt = atom({ plugin: 'context-doctor', key: 'prompt' } as const, null, { shape: 'prompt-1' })
const context = atom({ plugin: 'context-doctor', key: 'context' } as const, null, { shape: 'context-1' })
const isBusy = atom({ plugin: 'context-doctor', key: 'isBusy' } as const, false)

let home = ''
let seq = 0
let scan = 'node scanner/scan.mjs' // set from the plugin root in register
let lang: Lang = 'en'
const tr = () => STRINGS[lang]
const quote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`

// same estimate as scan.mjs: Thai ≈0.7 chars/token, other text ≈2.46
function tokens(text: string) {
  const thai = (text.match(/[\u0E00-\u0E7F]/g) ?? []).length
  return Math.round(thai * 1.44 + (text.length - thai) / 2.46)
}

function oneLine(text: string, max = 140) {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

async function homeDir($: EngineInterface) {
  if (!home) home = (await $.process.run(['sh', '-c', 'printf %s "$HOME"'])).stdout
  return home
}

async function sh($: EngineInterface, cmd: string, timeoutMs = 120_000) {
  return $.process.run(['sh', '-c', cmd], { timeoutMs })
}

async function loadDoc($: EngineInterface, target: View, flags: string) {
  await update($, isBusy, () => true)
  try {
    const { exitCode, stdout, stderr } = await sh($, `${scan} ${flags}`)
    const doc: Doc = exitCode === 0
      ? { markdown: stdout.replace(/\n(Full report|รายงานเต็ม):.*$/s, ''), at: await $.clock.now(), isError: false }
      : { markdown: `${tr().scanFailed(exitCode)}\n\n\`\`\`\n${stderr.slice(0, 2000)}\n\`\`\``, at: await $.clock.now(), isError: true }
    await update($, docs, all => ({ ...all, [target]: doc }))
  } finally {
    await update($, isBusy, () => false)
  }
}

async function loadPlugins($: EngineInterface) {
  const { exitCode, stdout } = await sh($, `${scan} --plugins`)
  if (exitCode === 0) await update($, plugins, () => JSON.parse(stdout) as PluginRow[])
}

async function togglePlugin($: EngineInterface, row: PluginRow) {
  const to = row.enabled ? 'off' : 'on'
  const { exitCode, stderr } = await sh($, `${scan} --set-plugin '${row.id.replace(/'/g, '')}' ${to}`)
  if (exitCode !== 0) {
    $.ui.toast(tr().toggleFailed(row.name, oneLine(stderr, 80)))
    return
  }
  $.ui.toast(tr().toggled(row.name, to === 'on'))
  await loadPlugins($)
}

// The composed prompt holds what is not on disk (MCP and claude.ai connector instructions); scan.mjs reads the
// saved copy, so it is written at session start too, without touching the pane.
async function capturePrompt($: EngineInterface) {
  const { sections } = await $.prompt.compose()
  const ctx = await read($, context)
  const body = [
    `# ${tr().promptTitle}`,
    '',
    ...sections.flatMap(s => [`<!-- section: ${s.id} · ${s.scope} · ≈${tokens(s.text)} tokens -->`, s.text, '']),
    ctx ? `\n# ${tr().blocksTitle}\n\n${ctx.blocks.map(b => `- ${b.name} ≈${b.tokens} tokens`).join('\n')}` : '',
  ].join('\n')
  const file = `${await homeDir($)}/.claude/context-doctor/system-prompt.md`
  await $.fs.write(file, body)
  return { sections, file }
}

async function loadPrompt($: EngineInterface) {
  await update($, isBusy, () => true)
  try {
    const { sections, file } = await capturePrompt($)
    const info: PromptInfo = {
      sections: sections.map(s => ({ id: s.id, scope: s.scope, tokens: tokens(s.text), head: oneLine(s.text, 90) })),
      totalTokens: sections.reduce((a, s) => a + tokens(s.text), 0),
      file,
      at: await $.clock.now(),
    }
    await update($, prompt, () => info)
  } finally {
    await update($, isBusy, () => false)
  }
}

async function load($: EngineInterface, target: View) {
  if (target === 'summary') return loadDoc($, 'summary', '--summary')
  if (target === 'usage') return loadDoc($, 'usage', '--usage')
  if (target === 'diff') return loadDoc($, 'diff', '--diff')
  if (target === 'plugins') return loadPlugins($)
  if (target === 'prompt') return loadPrompt($)
}

async function show($: EngineInterface, target: View) {
  await update($, view, () => target)
  await $.ui.open({ id: PANE, title: TITLE })
  void load($, target)
}

async function record($: EngineInterface, event: Omit<LiveEvent, 'id' | 'turn'>) {
  const { turn } = await read($, turns)
  const id = `${turn}-${seq++}`
  await update($, live, list => [...list, { ...event, id, turn }].slice(-300))
}

async function openReport($: EngineInterface, name: string) {
  const file = quote(`${await homeDir($)}/.claude/context-doctor/${name}`)
  await sh($, `if command -v open >/dev/null; then open ${file}; else xdg-open ${file}; fi`)
}

async function init($: EngineInterface) {
  const r = await sh($, `${scan} --print-lang`, 10_000).catch(() => null)
  if (r && r.stdout.trim() === 'th') lang = 'th'
}

export const register: Register = (on, options) => {
  scan = `node ${quote(`${options.root}/scanner/scan.mjs`)}`

  on('session.start', async ($, e, next) => {
    await init($)
    for (const v of VIEWS) await $.command.register({ name: v.command, description: tr().views[v.view][1] ?? '' })
    // save the composed prompt first so the scan sees MCP instructions, then tell the user what changed
    void capturePrompt($).catch(() => {}).then(() => sh($, `${scan} --diff --exit-code`)).then(r => {
      if (r && r.exitCode === 3) $.ui.toast(tr().changed)
    }).catch(() => {})

    return next(e)
  })

  for (const v of VIEWS) {
    on('command.run', { command: v.command }, async $ => {
      await show($, v.view).catch(() => {})

      return { text: tr().opened(tr().views[v.view][0] ?? '') }
    })
  }

  // the blocks attached to the first message (every CLAUDE.md incl. @imports, email, date): observed, never changed
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    try {
      const info: ContextInfo = {
        blocks: result.blocks.map(b => ({ name: b.name, tokens: tokens(b.text) })),
        files: (e.instructionFiles ?? []).map(f => ({ path: f.path, kind: String(f.kind), tokens: tokens(f.content) })),
      }
      await update($, context, () => info)
    } catch {}

    return result
  })

  // observe-only hooks: a failed record must never fail the prompt or the tool call
  on('prompt.submit', async ($, e, next) => {
    await update($, turns, t => ({ turn: t.turn + 1, tools: 0 })).catch(() => {})
    const result = await next(e)
    if ('context' in result && result.context?.length) {
      for (const c of result.context) await record($, { kind: 'prompt-hook', name: 'UserPromptSubmit', detail: oneLine(c) }).catch(() => {})
    }

    return result
  })

  on('tool.call', async ($, e, next) => {
    await update($, turns, t => ({ ...t, tools: t.tools + 1 })).catch(() => {})
    const args = e as unknown as Record<string, unknown>
    if (e.tool === 'Skill') await record($, { kind: 'skill', name: String(args.skill ?? '?'), detail: oneLine(String(args.args ?? '')) }).catch(() => {})
    else if (e.tool === 'Agent') await record($, { kind: 'agent', name: String(args.subagent_type ?? 'general-purpose'), detail: oneLine(String(args.description ?? '')) }).catch(() => {})
    else if (e.tool.startsWith('mcp__')) await record($, { kind: 'mcp', name: e.tool.replace(/^mcp__/, ''), detail: '' }).catch(() => {})

    const result = await next(e)
    if ('deny' in result && result.deny) await record($, { kind: 'deny', name: e.tool, detail: oneLine(result.deny) }).catch(() => {})
    else if ('context' in result && result.context?.length) {
      for (const c of result.context) await record($, { kind: 'hook', name: e.tool, detail: oneLine(c) }).catch(() => {})
    }

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const current = await read($, view)
    const busy = await read($, isBusy)
    const rows = Math.max(6, (e.viewport?.rows ?? 30) - 6)

    const tabs = (
      <Box flexWrap="wrap">
        {VIEWS.map(v => (
          <Button key={`tab-${v.view}`} label={v.view === current ? `[${tr().views[v.view][0]}]` : tr().views[v.view][0]} onPress={() => show($, v.view)} />
        ))}
      </Box>
    )
    const toolbar = (
      <Box>
        <Button key="reload" label={busy ? tr().loading : tr().reload} onPress={() => { if (!busy) void load($, current) }} />
        <Text> </Text>
        <Button key="open" label={tr().openHtml} onPress={() => openReport($, 'report.html')} />
      </Box>
    )

    let body
    if (current === 'summary' || current === 'usage' || current === 'diff') {
      const doc = (await read($, docs))[current]
      body = doc ? <Markdown key={`doc-${current}`} text={doc.markdown} /> : <Text dimColor>{busy ? tr().loading : tr().pressReload}</Text>
    } else if (current === 'prompt') {
      const info = await read($, prompt)
      const ctx = await read($, context)
      body = (
        <Box flexDirection="column">
          {info === null
            ? <Text dimColor>{busy ? tr().composing : tr().pressReload}</Text>
            : <Box flexDirection="column">
                <Text weight="bold">System prompt: {info.sections.length} sections ≈{info.totalTokens.toLocaleString()} tokens</Text>
                {info.sections.map(s => (
                  <Text key={`sec-${s.id}`}>
                    <Text color={s.scope === 'shared' ? 'suggestion' : 'warning'}>{s.scope === 'shared' ? 'S' : 'P'}</Text> {s.id.padEnd(22)} {String(s.tokens).padStart(6)}  <Text dimColor>{s.head}</Text>
                  </Text>
                ))}
                <Text dimColor>{tr().scopes}</Text>
                <Button key="open-prompt" label={tr().openPrompt} onPress={() => openReport($, 'system-prompt.md')} />
              </Box>}
          <Text> </Text>
          <Text weight="bold">{tr().firstMsg}</Text>
          {ctx === null
            ? <Text dimColor>{tr().notCaptured}</Text>
            : <Box flexDirection="column">
                {ctx.blocks.map(b => <Text key={`blk-${b.name}`}>{b.name.padEnd(22)} {String(b.tokens).padStart(6)}</Text>)}
                {ctx.files.map(f => <Text key={`file-${f.path}`} dimColor>  {f.kind.padEnd(10)} {String(f.tokens).padStart(6)}  {f.path}</Text>)}
              </Box>}
        </Box>
      )
    } else if (current === 'live') {
      const list = await read($, live)
      const t = await read($, turns)
      const mark: Record<LiveEvent['kind'], [string, string]> = {
        skill: ['SKILL', 'success'], agent: ['AGENT', 'claude'], mcp: ['MCP', 'suggestion'],
        hook: ['HOOK→', 'warning'], 'prompt-hook': ['HOOK→', 'warning'], deny: ['DENY', 'error'],
      }
      body = (
        <Box flexDirection="column">
          <Text dimColor>{tr().liveHead(t.turn, t.tools)}</Text>
          {list.length === 0 && <Text dimColor>{tr().noEvents}</Text>}
          {list.slice(-rows).map(ev => (
            <Text key={ev.id}>
              <Text dimColor>{String(ev.turn).padStart(3)} </Text>
              <Text color={mark[ev.kind][1]}>{mark[ev.kind][0].padEnd(6)}</Text> {ev.name} <Text dimColor>{ev.detail}</Text>
            </Text>
          ))}
        </Box>
      )
    } else {
      const list = await read($, plugins)
      body = list === null
        ? <Text dimColor>{tr().loading}</Text>
        : (
          <Box flexDirection="column">
            <Text dimColor>{tr().pluginsHead}</Text>
            {[...list].sort((a, b) => b.listingTokens - a.listingTokens).map(p => (
              <Box key={`pl-${p.id}`}>
                {p.isToggleable
                  ? <Button key={`tg-${p.id}`} label={p.enabled ? tr().off : tr().on} onPress={() => togglePlugin($, p)} />
                  : <Text dimColor>sync </Text>}
                <Text color={p.enabled ? 'text' : 'inactive'}> {p.enabled ? '●' : '○'} {p.name.padEnd(20)} {`${p.skills}/${p.commands}/${p.agents}/${p.hooks}`.padEnd(14)} ≈{p.listingTokens.toLocaleString()}{p.isProjectOverride ? tr().projectSet : ''}</Text>
              </Box>
            ))}
          </Box>
        )
    }

    return (
      <Box flexDirection="column">
        {tabs}
        {toolbar}
        {body}
      </Box>
    )
  })
}
