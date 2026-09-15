# ADR 0002: Tauri 2 over Electron for the desktop shell

Date: 2026-09-14
Status: accepted

## Context

The desktop app is a floating button and a side panel that sit on screen all day. It must be
frameless and transparent, always on top, skip the taskbar and dock, use native window materials
(vibrancy on macOS, Mica or Acrylic on Windows), watch a folder, run `git status`, and open a
terminal. It must run on macOS, Windows and Linux. The selection criteria for every technology in
Ledge are low RAM, low battery use and simplicity.

## Options considered

### Electron

- RAM and battery: ships its own Chromium and Node; an always resident app costs hundreds of
  megabytes at idle and keeps a renderer process alive.
- Native effects: vibrancy and Mica need native modules or third party packages.
- Simplicity: one language everywhere, very well documented.

### Native per OS (Swift, WinUI, GTK)

- RAM and battery: best possible.
- Native effects: first class.
- Simplicity: three code bases, three sets of UI, three release pipelines; against the ten minute
  install goal for contributors.

### Tauri 2

- RAM and battery: uses the OS webview (WebKit on macOS, WebView2 on Windows, WebKitGTK on
  Linux), so the binary is a few megabytes and idle memory is a fraction of Electron's.
- Native effects: `window-vibrancy` gives macOS Sidebar material and Windows Mica or Acrylic from
  the compositor; transparent, frameless, always on top windows are configuration.
- Simplicity: a Rust shell that must stay small; the build machine needs a Rust toolchain; the UI
  is ordinary web code.

## Decision

Tauri 2 with a Svelte 5 UI. Rust does only what the webview cannot: create the two windows, apply
vibrancy, toggle and snap, watch the task folder with `notify`, and launch a terminal. Every other
line is TypeScript, and all parsing goes through `@ledge/core` so the CLI and the app share one
implementation.

Svelte 5 is chosen for the same reasons: it compiles to direct DOM updates with no virtual DOM and
no framework runtime loop, so a hidden panel costs nothing. Vite builds it and Vitest tests it with
the same configuration.

## Consequences

- Building from source needs Rust via rustup and the platform's Tauri prerequisites, which the
  README links. People who do not build from source download an installer from GitHub Releases.
- Linux behaviour varies by compositor: KDE gets blur through the KWin hint, GNOME gets a
  translucent tint, and without a compositor the button renders opaque. This is accepted and is
  on the manual QA list.
- Rust code cannot be compiled on the phase 0 build machine, so it is kept minimal, written
  against the Tauri 2 API exactly, and checked by `cargo check` in CI on all three operating
  systems. That job is advisory until the app compiles, then becomes required.
- Low resource rules follow from this choice and are part of the design: no animation loops while
  the panel is hidden, OS file events instead of polling, a five minute scan interval, at most
  four git processes at once.
