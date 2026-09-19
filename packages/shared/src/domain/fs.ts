/** File explorer domain (spec §11 explorer pane). */
export type FileEntry = {
  name: string
  /** Path relative to the project root, using '/' separators. */
  path: string
  kind: 'dir' | 'file'
  size?: number
}

/** Terminal session metadata exposed to the renderer. */
export type TerminalInfo = {
  id: string
  projectId: string
  title: string
  cwd: string
  createdAt: string
}
