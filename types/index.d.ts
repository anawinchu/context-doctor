export type View = 'summary' | 'prompt' | 'live' | 'usage' | 'diff' | 'plugins'

export type Doc = { markdown: string; at: number; isError: boolean }

export type PluginRow = {
  id: string
  name: string
  enabled: boolean
  isToggleable: boolean
  isProjectOverride: boolean
  skills: number
  commands: number
  agents: number
  hooks: number
  listingTokens: number
}

export type LiveEvent = {
  id: string
  turn: number
  kind: 'skill' | 'agent' | 'mcp' | 'hook' | 'deny' | 'prompt-hook'
  name: string
  detail: string
}

export type PromptInfo = {
  sections: { id: string; scope: string; tokens: number; head: string }[]
  totalTokens: number
  file: string
  at: number
}

export type ContextInfo = {
  blocks: { name: string; tokens: number }[]
  files: { path: string; kind: string; tokens: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-doctor': {
      view: View
      docs: Shaped<Partial<Record<View, Doc>>>
      plugins: Shaped<PluginRow[] | null>
      live: Shaped<LiveEvent[]>
      turns: Shaped<{ turn: number; tools: number }>
      prompt: Shaped<PromptInfo | null>
      context: Shaped<ContextInfo | null>
      isBusy: boolean
    }
  }
}
