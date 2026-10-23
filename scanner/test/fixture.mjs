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
  write(path.join(claude, 'CLAUDE.md'), '@GUIDE.md\n# Personal rules\n- Never push without asking.\n')
  write(path.join(claude, 'GUIDE.md'), '# Research guide\n' + 'Always cite primary sources before summarizing. '.repeat(120))
  json(path.join(claude, 'settings.json'), {
    language: 'English',
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] },
    mcpServers: { warehouse: { command: 'python3', args: ['-m', 'warehouse_mcp'], env: { DB_PASSWORD: 'hunter2', DB_HOST: 'db.internal' } } },
    enabledPlugins: { 'megapack@market': true, 'tiny@market': true },
  })
  skill(path.join(claude, 'skills'), 'research', 'Deep research with citations. Use when the user asks for a literature review.', '- Never invent sources.\n- Always list URLs.')
  skill(path.join(claude, 'skills'), 'scratch', '', 'No description on purpose.')

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
  write(path.join(project, 'CLAUDE.md'), '# Shop app\n- Ask before deploy or push.\n- Code review: use /code-review.\n')
  json(path.join(project, '.claude/settings.json'), {})
  skill(path.join(project, '.claude/skills'), 'deploy', 'Deploy to production then commit and push. Use when the user asks to ship, or after finishing a change that must go live.')

  // a transcript: the built-in /plan was typed (must not count as megapack:plan), research skill invoked
  const slug = project.replace(/[^A-Za-z0-9]/g, '-')
  write(path.join(claude, 'projects', slug, 'one.jsonl'), [
    '{"type":"user","message":{"content":"<command-name>/plan</command-name>"}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"research"}}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Agent","input":{"subagent_type":"Explore"}}]}}',
  ].join('\n'))

  return { root, home, claude, project }
}
