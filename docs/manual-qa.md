# Manual QA checklist

Status: written ahead of phase 1. Nothing here has been run yet because the desktop app is not
built. Automated tests cover parsing, the store, the CLI, the hooks and the Svelte components;
this list covers what only a person at a real screen can check: window effects, drag and snap,
and terminal launch.

Run the whole list on each OS before tagging a release. Record the OS version, the commit and the
date at the top of your results, then paste the results into the release pull request.

## Setup

- [ ] Fresh `LEDGE_HOME` pointing at a temporary folder; `ledge init` run once
- [ ] Three tasks: one `current` with a repo, one `backlog` with a `parked` reason, one `done`
- [ ] Two repositories under a scan root: one clean and pushed, one with a dirty file and an
  unpushed commit
- [ ] One deliberately malformed task file (for example `status: later`)

## Button window (all OSes)

- [ ] Appears as a 44 px circle, frameless and transparent, with no title bar
- [ ] Stays above every other window, does not appear in the taskbar or dock
- [ ] Shows the Current count; the count updates within a second of `ledge start` on another task
- [ ] Clicking it does not steal focus from the app you were typing in
- [ ] Drag anywhere on the screen; on release it snaps to the nearest left or right edge
- [ ] `config.json` `ui.edge` and `ui.y` are written after the snap; relaunch restores the spot
- [ ] Right click shows Refresh git, Open tasks folder, Settings, Quit; each does what it says
- [ ] Linux without a compositor: the circle renders opaque rather than as a black square

## Panel window (all OSes)

- [ ] Left click on the button slides the panel in from the same edge; second click slides it out
- [ ] 380 px wide, full working area height minus margins, does not cover the taskbar or dock
- [ ] Closes when it loses focus; stays open when pinned from the header
- [ ] Follows the system light or dark setting; the override in Settings wins when set
- [ ] Malformed task file shows as a row with a warning badge and the parse error; nothing crashes

## Window effects

| OS | Check |
|---|---|
| macOS | Sidebar vibrancy behind the panel, 14 px corner radius, no white flash on open |
| Windows 11 | Mica material, 8 px radius |
| Windows 10 | Acrylic fallback, 8 px radius |
| Linux KDE | Translucent tint plus KWin blur behind the panel |
| Linux GNOME | Translucent tint, no blur, still readable |

## Tabs

- [ ] Current lists tasks by `order`; drag to reorder writes `order` back to the files
- [ ] Current row shows title, repo short name, branch and ahead count, progress bar, last session
  time
- [ ] Backlog lists by `updated` desc and shows the parked reason; Start moves the task to Current
- [ ] Pending shows the dirty repository and not the clean one; the row shows the task title when
  a task references the repo
- [ ] Refresh git re-runs the scan; a commit and push in the dirty repo removes its row

## Task detail

- [ ] Back link returns to the tab you came from
- [ ] Toggling a checklist item writes `[x]` or `[ ]` to the file; `cat` the file to confirm
- [ ] Park asks for a reason and moves the task to Backlog
- [ ] Mark done moves the file to `archive/` and the row disappears
- [ ] Open folder opens the repo in the file manager

## File watching

- [ ] Edit a task title in a text editor and save; the row updates within a second
- [ ] Create a new task with `ledge add`; it appears without a relaunch
- [ ] Delete a task file; the row disappears
- [ ] Edit `config.json` `ui.theme`; the panel switches theme without a relaunch

## Terminal launch (phase 2)

| OS | Terminal | Check |
|---|---|---|
| macOS | Terminal.app | Resume in Claude opens a new Terminal window in the task repo running `claude --resume <id>` |
| macOS | Terminal.app | Open in Claude on a task with no sessions runs `claude "<prompt>"` with the title, requirement and unchecked items |
| Windows | wt | Same two checks in Windows Terminal |
| Linux | x-terminal-emulator | Same two checks in the default terminal |
| any | a terminal that is not installed | The panel shows the exact command to copy; nothing crashes |

- [ ] The SessionStart hook in the launched session prints the task context
- [ ] A task with no repo opens the terminal in the home folder

## Resource use

- [ ] With the panel hidden, CPU use of the app sits at zero between scans (Activity Monitor,
  Task Manager, or `top`)
- [ ] Memory after ten minutes idle, note the number in your results
- [ ] No git processes running between scans
