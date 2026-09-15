//! Ledge desktop shell. Kept deliberately small: window placement, native glass, and a
//! terminal launcher. Everything else (file IO, watching, git) runs in the webview through
//! the fs and shell plugins, so the Rust side has almost nothing to get wrong.

use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const BUTTON: &str = "button";
const PANEL: &str = "panel";
/// Gap in physical pixels between the button, the panel and the edge of the work area.
const MARGIN: i32 = 12;
/// Panel height as a share of the work area height, with a floor and a ceiling in physical
/// pixels. From section 6 of the v2 contract.
const PANEL_HEIGHT_FRACTION: f64 = 0.60;
const PANEL_HEIGHT_MIN: i32 = 420;
const PANEL_HEIGHT_MAX: i32 = 900;

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

/// Places the panel beside the button on the same screen edge, vertically centred on the
/// button, then shows or hides it. Returns the new visibility.
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

/// Panel height in physical pixels for a work area `area_h` tall. The v2 contract asks for
/// 60 percent of the work area with a floor of 420 and a ceiling of 900: full height made
/// the panel read as an application window, and the floor and ceiling keep it usable on both
/// a small laptop display and a tall external one. The result is then trimmed to what the
/// work area can actually hold once the margins are taken off, so a short display gets a
/// short panel instead of one that hangs off the screen.
fn panel_height(area_h: i32) -> u32 {
    let fitted = (area_h - 2 * MARGIN).max(1);
    let wanted = (f64::from(area_h) * PANEL_HEIGHT_FRACTION).round() as i32;
    wanted
        .clamp(PANEL_HEIGHT_MIN, PANEL_HEIGHT_MAX)
        .min(fitted) as u32
}

/// Sizes the panel per the contract and parks it beside the button on the same screen edge,
/// centred on the button vertically so it reads as belonging to the button rather than to
/// the screen. Both axes are clamped inside the work area, so a button near the top or
/// bottom edge still gets a panel that is fully on screen.
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
    let area_y = area.position.y;
    let area_w = area.size.width as i32;
    let area_h = area.size.height as i32;
    let height = panel_height(area_h);
    let width = panel_size.width;

    let button_center_x = button_pos.x + button_size.width as i32 / 2;
    let on_left = button_center_x < area_x + area_w / 2;
    let x = if on_left {
        button_pos.x + button_size.width as i32 + MARGIN
    } else {
        button_pos.x - width as i32 - MARGIN
    };

    let button_center_y = button_pos.y + button_size.height as i32 / 2;
    let top = area_y + MARGIN;
    let bottom = area_y + area_h - height as i32 - MARGIN;
    let y = (button_center_y - height as i32 / 2).clamp(top, bottom.max(top));

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

/// Pins `win` above every other application, for the lifetime of the window.
///
/// On macOS this is the whole fix for the button vanishing on an application switch.
/// `alwaysOnTop` in tauri.conf.json only reaches NSFloatingWindowLevel (3), and a floating
/// window belonging to an inactive application is still ordered under the windows of the
/// application the person just activated, so the button went behind Finder, behind the
/// application switcher and behind anything full screen. Four AppKit settings fix it:
///
/// - `setLevel:` NSStatusWindowLevel (25) puts the window above the menu bar (24) and above
///   any ordinary or floating application window, whichever application is active.
/// - `setCollectionBehavior:` CanJoinAllSpaces keeps it on screen when the person switches
///   Space, Stationary stops Mission Control and Exposé from sliding it away with the rest
///   of the Space, and FullScreenAuxiliary lets it draw on a full screen application's own
///   Space instead of being left behind on the Space it was created in.
/// - `setIgnoresMouseEvents:` false is set explicitly, because the window is only useful if
///   it still takes the click that opens the panel and the drag that moves it. Raising the
///   level does not change hit testing, but the button is transparent and borderless, which
///   is exactly the shape of window people make click-through by accident, so it is stated
///   here rather than assumed.
/// - `setHidesOnDeactivate:` false stops AppKit ordering the window out when Ledge stops
///   being the active application.
///
/// Failure is logged and swallowed: a button at the wrong level is worth having, a dead app
/// is not.
#[cfg(target_os = "macos")]
fn pin_above_all_apps(win: &WebviewWindow) {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
    use objc2_foundation::NSInteger;

    let label = win.label().to_string();
    let ptr = match win.ns_window() {
        Ok(ptr) => ptr,
        Err(e) => {
            eprintln!("ledge: no NSWindow for `{label}`, cannot pin it above other apps: {e}");
            return;
        }
    };

    // SAFETY: `ns_window()` returns the live NSWindow backing this Tauri window, borrowed
    // rather than owned, so `retain` is the balanced way to hold it: it takes +1 here and
    // `Retained` gives it back on drop. NSWindow is a MainThreadOnly class and this runs
    // from the Tauri setup hook, which is the main thread.
    let ns_window = match unsafe { Retained::retain(ptr.cast::<NSWindow>()) } {
        Some(w) => w,
        None => {
            eprintln!("ledge: NSWindow for `{label}` was null, cannot pin it above other apps");
            return;
        }
    };

    let level: NSInteger = NSStatusWindowLevel;
    ns_window.setLevel(level);
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    ns_window.setIgnoresMouseEvents(false);
    ns_window.setHidesOnDeactivate(false);
}

/// Pins `win` above every other application, for the lifetime of the window.
///
/// Windows and Linux have no equivalent of a status window level worth reaching for from
/// here, and forcing one through the platform APIs behaves differently on every compositor,
/// so the intent is expressed with what the window manager already understands: stay on
/// top, and stay out of the taskbar so the button is never something the person has to go
/// and find. Both are re-asserted at runtime rather than left to tauri.conf.json alone,
/// because a window manager that ignored the hint at creation often honours it later.
#[cfg(not(target_os = "macos"))]
fn pin_above_all_apps(win: &WebviewWindow) {
    if let Err(e) = win.set_always_on_top(true) {
        eprintln!("ledge: could not keep `{}` on top: {e}", win.label());
    }
    if let Err(e) = win.set_skip_taskbar(true) {
        eprintln!("ledge: could not keep `{}` out of the taskbar: {e}", win.label());
    }
}

/// Records a message from the webview on the process error stream. The panel can only show
/// one line of error text at a time and disappears when it loses focus, so without this a
/// failure that happens while nobody is looking leaves no trace to debug from.
#[tauri::command]
fn log_message(level: String, message: String) {
    eprintln!("ledge [{level}]: {message}");
}

/// Parks the button against the right edge of the work area, vertically centred, the first
/// time the app starts. Without this the window manager decides, which drops a 48 pixel
/// square in the middle of the screen. The webview calls `snap_button` afterwards with the
/// position saved in config, so this only has to be a sensible default.
fn place_button_initial(app: &AppHandle) {
    let Ok(button) = window(app, BUTTON) else { return };
    let Ok(Some(monitor)) = button.current_monitor() else { return };
    let area = monitor.work_area();
    let Ok(size) = button.outer_size() else { return };
    let x = area.position.x + area.size.width as i32 - size.width as i32 - MARGIN;
    let y = area.position.y + (area.size.height as i32 - size.height as i32) / 2;
    let _ = button.set_position(PhysicalPosition::new(x, y));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            // Ledge is an assistant panel, not an application. Accessory keeps it out of the
            // Dock and out of the application switcher, so the floating button is the only
            // thing the person ever sees of it.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // The button is the one thing that must never be covered or ordered out, and
            // the panel gets the same treatment so that opening it over a full screen
            // application shows the panel rather than nothing.
            if let Some(button) = app.get_webview_window(BUTTON) {
                pin_above_all_apps(&button);
            }
            if let Some(panel) = app.get_webview_window(PANEL) {
                pin_above_all_apps(&panel);
                apply_glass(&panel);
                // The panel opens only when the button is pressed. Hiding it explicitly here
                // matters because applying the native material realises the window, which can
                // leave it on screen in the wrong place and covering the button.
                let _ = panel.hide();
            }
            place_button_initial(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![toggle_panel, snap_button, open_terminal, log_message])
        .build(tauri::generate_context!())
        .expect("error while building Ledge");

    app.run(|_app, event| {
        // Hiding the panel must never end the process: the button has to stay on screen.
        if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Locks down section 6 of the v2 contract: 60 percent of the work area, never below
    /// 420 and never above 900, and never taller than the work area can hold with margins.
    /// The panel geometry is the one piece of this file that is pure arithmetic, so it is
    /// the one piece that can be checked without a window server.
    #[test]
    fn panel_height_follows_the_contract() {
        // A tall external display: the 60 percent share exceeds the ceiling.
        assert_eq!(panel_height(2400), 900);
        // A typical laptop work area: 60 percent lands between the floor and the ceiling.
        assert_eq!(panel_height(1000), 600);
        // 60 percent is below the floor, so the floor wins.
        assert_eq!(panel_height(600), 420);
        // The floor does not survive a work area too short to hold it with margins.
        assert_eq!(panel_height(400), 376);
        // Exactly at the ceiling and exactly at the floor.
        assert_eq!(panel_height(1500), 900);
        assert_eq!(panel_height(700), 420);
    }
}
