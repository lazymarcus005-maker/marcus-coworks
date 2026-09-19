# Your first project

1. Launch the app and click **Add Project…** (the `+` next to the tab
   bar). Pick any folder — a Git repository is recommended but not
   required.
2. The project opens as a tab. Tabs can be closed (the project stays
   registered) and reopened from the `+` menu.
3. The layout: file explorer on the left, chat in the center, the
   Task/TODO panel on the right, and a terminal dock at the bottom.
4. Type a request in the chat. Short requests go straight to the agent;
   substantial ones (long or multi-line) also create a **Goal draft**
   plus an initial task in the durable task store.
5. The first send starts an OpenCode server automatically (one shared
   runtime, one session per project). Replies stream token by token.

## Projects are isolated

Each project has its own OpenCode session, chat history, tasks, goal,
terminals, and status. Switching tabs never interrupts background work in
another project.

## Rename / remove

- Double-click the project name to rename it.
- **Remove…** unregisters the project. Agent Studio history can be
  dropped with a checkbox; **your source files are never deleted**.
