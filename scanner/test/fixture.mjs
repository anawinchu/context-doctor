// Builds a throwaway home directory with a small, realistic Claude Code setup.
// Used by the tests and by the README screenshot (no real user data involved).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
const json = (file, value) => write(file, JSON.stringify(value, null, 2))
const skill = (dir, name, description, body = '') => write(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\n${description ? `description: ${description}\n` : ''}---\n\n${body}\n`)

export function buildFixture(root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-doctor-'))) {
  const home = path.join(root, 'home'), claude = path.join(home, '.claude'), project = path.join(home, 'work', 'shop-app')

  // user memory with a large user-level @import
  write(path.join(claude, 'CLAUDE.md'), '@GUIDE.md\n# Personal rules\n- Never git push without asking.\n- Run the unit tests before you open a merge request.\n')
  write(path.join(claude, 'GUIDE.md'), '# Research guide\n' + 'Always cite primary sources before summarizing. '.repeat(120))
  json(path.join(claude, 'settings.json'), {
    language: 'English',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }],
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'curl -s -H "Authorization: Bearer tok_live_9f8e7d6c5b4a" https://hooks.example/collect' }] }],
    },
    env: { SERVICE_API_KEY: 'plain-value-123', MAX_THINKING_TOKENS: '8000' },
    mcpServers: { warehouse: { command: 'python3', args: ['-m', 'warehouse_mcp'], env: { DB_PASSWORD: 'hunter2', DB_HOST: 'db.internal' } } },
    enabledPlugins: { 'megapack@market': true, 'tiny@market': true },
  })
  skill(path.join(claude, 'skills'), 'research', 'Deep research with citations. Use when the user asks for a literature review.', '- Never invent sources.\n- Always list URLs.')
  skill(path.join(claude, 'skills'), 'scratch', '', 'No description on purpose.')
  // YAML that fails: an unquoted value containing ": "
  write(path.join(claude, 'skills/broken/SKILL.md'), '---\nname: broken\ndescription: DEPRECATED: renamed to tidy\n---\nBody.\n')
  // agents: one never loads (no description), two collide on one name
  write(path.join(claude, 'agents/silent.md'), '---\nname: silent\n---\nNo description.\n')
  write(path.join(claude, 'agents/helper-a.md'), '---\nname: helper\ndescription: First helper.\n---\n')
  write(path.join(claude, 'agents/helper-b.md'), '---\nname: helper\ndescription: Second helper.\n---\n')

  // a catch-all plugin: many skills, a pressure-worded agent, a hook
  const mega = path.join(claude, 'plugins/cache/market/megapack/1.0.0')
  json(path.join(mega, '.claude-plugin/plugin.json'), { name: 'megapack', version: '1.0.0', description: 'Everything for everyone' })
  for (let i = 0; i < 45; i++) skill(path.join(mega, 'skills'), `helper-${i}`, `Helper number ${i} for many languages and frameworks. Use when working with stack ${i}.`)
  skill(path.join(mega, 'skills'), 'code-review', 'Review code changes for quality. Use when the user asks for a review.')
  skill(path.join(mega, 'skills'), 'plan', 'Write an implementation plan. Use when planning features.')
  write(path.join(mega, 'agents/code-reviewer.md'), '---\nname: code-reviewer\ndescription: Expert reviewer. Use PROACTIVELY after any edit. MUST BE USED for all code changes.\n---\nReview.\n')
  write(path.join(mega, 'agents/security-reviewer.md'), '---\nname: security-reviewer\ndescription: Security reviewer. Use PROACTIVELY for auth code.\n---\nReview.\n')
  json(path.join(mega, 'hooks/hooks.json'), { hooks: { Stop: [{ matcher: '*', id: 'stop:format-typecheck', description: 'Format edited files', hooks: [{ type: 'command', command: 'node format.js' }] }] } })
  const tiny = path.join(claude, 'plugins/cache/market/tiny/0.1.0')
  json(path.join(tiny, '.claude-plugin/plugin.json'), { name: 'tiny', version: '0.1.0' })
  skill(path.join(tiny, 'skills'), 'tidy', 'Routing helper. No PROACTIVELY or MUST BE USED pressure here. Use when tidying descriptions.')
  json(path.join(claude, 'plugins/installed_plugins.json'), { version: 2, plugins: {
    'megapack@market': [{ scope: 'user', installPath: mega, version: '1.0.0' }],
    'tiny@market': [{ scope: 'user', installPath: tiny, version: '0.1.0' }],
  } })

  // project: memory, an owned deploy skill that invites auto-push, settings
  write(path.join(project, 'CLAUDE.md'), '# Shop app\n- Ask before deploy or push.\n- Code review: use /code-review.\n- Run the unit tests before you open a merge request.\n- Demo login: admin@shop.test / s3cretpw9\n')
  // rules: one always loaded, one only for matching paths
  write(path.join(project, '.claude/rules/style.md'), '# Style\n- Always use tabs.\n')
  write(path.join(project, '.claude/rules/api/routes.md'), '---\npaths:\n  - "app/api/**"\n---\n# API routes\n' + 'Every route must check the tenant. '.repeat(200))
  json(path.join(project, '.claude/settings.json'), {})
  skill(path.join(project, '.claude/skills'), 'deploy', 'Deploy to production then commit and push. Use when the user asks to ship, or after finishing a change that must go live.', '- Always git push to origin after deploying.\n- You must pass `--mode deep` to every step.')

  // a transcript: the built-in /plan was typed (must not count as megapack:plan), research skill invoked
  const slug = project.replace(/[^A-Za-z0-9]/g, '-')
  // key order differs from the first line on purpose: parsing must not depend on it
  const ts = '2026-10-01T10:00:00.000Z'
  write(path.join(claude, 'projects', slug, 'one.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: ts, message: { content: '<command-name>/plan</command-name>' } }),
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'research' } }] } }),
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ input: { description: 'find', subagent_type: 'Explore' }, name: 'Agent', id: 't2', type: 'tool_use' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 't3', name: 'mcp__warehouse__query', input: {} }] } }),
    JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'ls' } }] } }),
    JSON.stringify({ type: 'user', timestamp: ts, toolDenialKind: 'permission-rule', message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'denied' }] } }),
    ...[1, 2, 3].map(() => JSON.stringify({ type: 'attachment', timestamp: ts, attachment: { type: 'hook_cancelled', hookName: 'PreToolUse:Bash', hookEvent: 'PreToolUse', command: 'office-hook pre', durationMs: 2100, timedOut: true, timeoutMs: 2000 } })),
    JSON.stringify({ type: 'attachment', timestamp: ts, attachment: { type: 'hook_success', hookName: 'PreToolUse:Bash', hookEvent: 'PreToolUse', command: 'rtk hook claude', durationMs: 40 } }),
  ].join('\n'))
  for (let i = 0; i < 4; i++) write(path.join(claude, 'projects', slug, `empty-${i}.jsonl`), '')
  // Claude Code's own counters and the claude.ai connectors this machine connected
  json(path.join(home, '.claude.json'), {
    skillUsage: { scratch: { usageCount: 7, lastUsedAt: Date.parse(ts) } },
    pluginUsage: { 'megapack@market': { usageCount: 0, lastUsedAt: Date.now() } },
    claudeAiMcpEverConnected: ['claude.ai Notion'],
  })
  // a second project, to prove state is kept per project
  const other = path.join(home, 'work', 'blog')
  write(path.join(other, 'CLAUDE.md'), '# Blog\n')

  return { root, home, claude, project, other }
}
