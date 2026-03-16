# Development Log

## [2026-03-12] UI Componentization & Group Chat Enhancements

### ✨ Features
- **Message Persistence**: Implemented REST API (`/api/messages`) for chat context persistence. Group and agent chats now survive browser reloads and backend restarts by serializing message data directly to `workspaces/{id}/messages.json` with seamless debounced autosaves.
- **Group Right Sidebar**: Introduced a dedicated right sidebar explicitly for the group chat view, clearly listing all current intelligent agents within the group.
- **Sliding Drawer Panels**:
  - **Workspace Files**: Repurposed from a central modal to a sleek right-side sliding panel (`WorkspaceFilesPanel`). Enhanced to support full CRUD (Create, Search, Rename, Edit context, Delete file).
  - **Cron Tasks**: Transferred to a right-side sliding panel (`CronTasksPanel`). Displays rich active task status and now explicitly supports modifying existing task arguments/prompts alongside additions/deletions.
- **Agent Group Invites**: Eliminated the primitive `window.prompt` behavior. Added a stylish, theme-aligned native dropdown located seamlessly under the 'Group Members' sidebar list. It dynamically filters out already-present members to facilitate elegant and rapid agent grouping.

### ♻️ Refactoring
- **Modular Architecture**: Dissolved the monolithic 700+ line `src/app/page.tsx` React component. Redesigned layout to mimic Vue's modular page structure.
- Abstracted `Sidebar`, `ChatArea`, `SettingsView`, and modal overlaps into `src/components/`. 
- `page.tsx` now operates strictly as a pristine top-level Container/Controller component focusing on hook management (`useChat`, active session state) and prop drilling.
- Extracted shared typescript types (`Agent`, `Group`) and generalized utils to `src/lib/`.

