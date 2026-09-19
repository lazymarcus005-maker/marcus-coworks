import type { AgentTreeNode } from '@studio/shared'
import { createEffect, createSignal, For, Show } from 'solid-js'

/**
 * Live delegation tree (spec §33): renders the runtime's session
 * hierarchy — parent session plus subagent children.
 */
export function AgentTreePanel(props: { sessionId: () => string | undefined }) {
  const [tree, setTree] = createSignal<AgentTreeNode | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    const id = props.sessionId()
    if (!id) return
    void window.studio.agents
      .tree(id)
      .then(({ tree: built }) => setTree(built))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  })

  const renderNode = (node: AgentTreeNode, depth: number) => (
    <div class="tree-node" style={`padding-left: ${depth * 14}px`}>
      <span class="tree-dot">●</span>
      <span class="tree-label" title={node.sessionId}>
        {node.sessionId.startsWith('ses_') ? node.sessionId.slice(4, 16) : node.sessionId}
      </span>
      <For each={node.children}>{(child) => renderNode(child, depth + 1)}</For>
    </div>
  )

  return (
    <div class="agent-tree">
      <div class="tasks-header">
        <h3>Agents</h3>
        <span class="muted">delegation tree</span>
      </div>
      <Show
        when={props.sessionId()}
        fallback={<div class="muted tasks-empty-goal">No active session yet.</div>}
      >
        <Show
          when={tree()}
          fallback={<div class="muted tasks-empty-goal">{error() ?? 'Loading tree…'}</div>}
        >
          {(t) => <div class="tree-body">{renderNode(t(), 0)}</div>}
        </Show>
      </Show>
    </div>
  )
}
