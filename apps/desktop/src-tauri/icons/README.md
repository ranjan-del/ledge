# Icons

This folder is intentionally empty of binaries. Tauri needs `32x32.png`, `128x128.png`,
`128x128@2x.png`, `icon.icns` and `icon.ico` here (the list in `tauri.conf.json` under
`bundle.icon`). Generate them from a single 1024x1024 PNG with the Tauri CLI:

```sh
cd apps/desktop
npm run tauri icon path/to/ledge-1024.png
```

The command writes every size and format into this folder. Commit the generated files once
a source image exists. Until then `tauri build` will fail on the missing icons; `cargo check`
does not need them.
