//! Ledge desktop shell. Kept deliberately small: window placement, native glass, and a
//! terminal launcher. Everything else (file IO, watching, git) runs in the webview through
//! the fs and shell plugins, so the Rust side has almost nothing to get wrong.

use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const BUTTON: &str = "button";
const PANEL: &str = "panel";
/// Gap in physical pixels between the button, the panel and the edge of the work area.
const MARGIN: i32 = 12;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("window `{label}` is not declared in tauri.conf.json"))
}

/// Snap result returned to the webview so it can persist `ui.edge` and `ui.y`.
#[derive(Serialize)]
pub struct Snapped {
    pub edge: String,
    pub y: i32,
}

/// Places the panel beside the button on the same screen edge, full work-area height
/// minus margins, then shows or hides it. Returns the new visibility.
#[tauri::command]
fn toggle_panel(app: AppHandle) -> Result<bool, String> {
    let panel = window(&app, PANEL)?;
    if panel.is_visible().map_err(err)? {
        panel.hide().map_err(err)?;
        return Ok(false);
    }
    place_panel(&app)?;
    panel.show().map_err(err)?;
    panel.set_focus().map_err(err)?;
    Ok(true)
}

fn place_panel(app: &AppHandle) -> Result<(), String> {
    let button = window(app, BUTTON)?;
    let panel = window(app, PANEL)?;
    let monitor = button
        .current_monitor()
        .map_err(err)?
        .ok_or("no monitor for the button window")?;
    let area = monitor.work_area();
    let button_pos = button.outer_position().map_err(err)?;
    let button_size = button.outer_size().map_err(err)?;
    let panel_size = panel.outer_size().map_err(err)?;

    let area_x = area.position.x;
    let area_w = area.size.width as i32;
    let area_h = area.size.height as i32;
    let height = (area_h - 2 * MARGIN).max(320) as u32;
    let width = panel_size.width;

    let button_center = button_pos.x + button_size.width as i32 / 2;
    let on_left = button_center < area_x + area_w / 2;
    let x = if on_left {
        button_pos.x + button_size.width as i32 + MARGIN
    } else {
        button_pos.x - width as i32 - MARGIN
    };
    let y = area.position.y + MARGIN;

    panel
        .set_size(PhysicalSize::new(width, height))
        .map_err(err)?;
    panel.set_position(PhysicalPosition::new(x, y)).map_err(err)?;
    Ok(())
}

/// Moves the button flush against the requested screen edge (`left` or `right`) at
/// vertical position `y`, clamped to the work area. Called after a drag ends.
#[tauri::command]
fn snap_button(app: AppHandle, edge: String, y: i32) -> Result<Snapped, String> {
    let button = window(&app, BUTTON)?;
    let monitor = button
        .current_monitor()
        .map_err(err)?
        .ok_or("no monitor for the button window")?;
    let area = monitor.work_area();
    let size = button.outer_size().map_err(err)?;
    let area_x = area.position.x;
    let area_y = area.position.y;
    let area_w = area.size.width as i32;
    let area_h = area.size.height as i32;

    let edge = if edge == "left" { "left" } else { "right" };
    let x = if edge == "left" {
        area_x + MARGIN
    } else {
        area_x + area_w - size.width as i32 - MARGIN
    };
    let max_y = area_y + area_h - size.height as i32 - MARGIN;
    let y = y.clamp(area_y + MARGIN, max_y.max(area_y + MARGIN));

    button.set_position(PhysicalPosition::new(x, y)).map_err(err)?;
    if let Ok(panel) = window(&app, PANEL) {
        if panel.is_visible().unwrap_or(false) {
            place_panel(&app)?;
        }
    }
    Ok(Snapped {
        edge: edge.to_string(),
        y,
    })
}

/// Opens the platform terminal in `dir` and runs `command` there. macOS uses Terminal.app
/// via `osascript`, Windows uses Windows Terminal (`wt`), Linux uses the Debian
/// `x-terminal-emulator` alternative. This is the fallback path; the webview normally
/// launches through the shell plugin so failures can show the exact command to copy.
#[tauri::command]
fn open_terminal(dir: String, command: String) -> Result<(), String> {
    let mut cmd = terminal_command(&dir, &command);
    cmd.spawn().map_err(err)?;
    Ok(())
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(target_os = "macos")]
fn terminal_command(dir: &str, command: &str) -> std::process::Command {
    let script_line = format!("cd {} && {}", shell_quote(dir), command);
    let escaped = script_line
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    let mut cmd = std::process::Command::new("osascript");
    cmd.arg("-e")
        .arg(format!("tell application \"Terminal\" to do script \"{escaped}\""))
        .arg("-e")
        .arg("tell application \"Terminal\" to activate");
    cmd
}

#[cfg(target_os = "windows")]
fn terminal_command(dir: &str, command: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new("wt");
    cmd.arg("-d").arg(dir).arg("cmd").arg("/k").arg(command);
    cmd
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn terminal_command(dir: &str, command: &str) -> std::process::Command {
    let script = format!("cd {} && {}; exec \"${{SHELL:-sh}}\"", shell_quote(dir), command);
    let mut cmd = std::process::Command::new("x-terminal-emulator");
    cmd.arg("-e").arg("sh").arg("-c").arg(script);
    cmd
}

/// Applies the native translucent material to the panel window. macOS: NSVisualEffectView
/// with the Sidebar material. Windows: Mica (Windows 11), falling back to Acrylic
/// (Windows 10). Linux: nothing; the CSS tint carries the look.
fn apply_glass(panel: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
        if let Err(e) = apply_vibrancy(panel, NSVisualEffectMaterial::Sidebar, None, Some(14.0)) {
            eprintln!("ledge: vibrancy unavailable: {e}");
        }
    }
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        if apply_mica(panel, None).is_err() {
            if let Err(e) = apply_acrylic(panel, Some((18, 18, 18, 125))) {
                eprintln!("ledge: acrylic unavailable: {e}");
            }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = panel;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            if let Some(panel) = app.get_webview_window(PANEL) {
                apply_glass(&panel);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![toggle_panel, snap_button, open_terminal])
        .run(tauri::generate_context!())
        .expect("error while running Ledge");
}
