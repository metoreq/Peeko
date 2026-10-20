# Peeko

A lightweight animated overlay for Windows. Peeko shows a small looping character (gif, video or animated image)
in the corner of your screen, on top of your games and apps. Clicks pass straight through it. It runs fully offline.

## Features
- Up to 6 overlays at once, each with its own skin, display, corner, size, margin and opacity
- Transparent, always-on-top, click-through and hidden from the taskbar
- Local skins only: drop files into the skins folder. Supports `.gif`, `.webp`, animated `.png`/`.apng`, `.webm`, `.mp4`
- Move mode to drag an overlay anywhere; hotkey **Ctrl+Alt+H** hides or shows all overlays
- Starts with Windows (optional), minimised to the tray
- Low impact: software rendering (no GPU use), small overlay windows, and an overlay you turn off is fully closed

## Install
Download from the Releases page:
- **Peeko-Setup-x.y.z.exe** - installer (Start Menu and desktop shortcuts, uninstaller)
- **Peeko-Portable-x.y.z.exe** - no install; keep it anywhere

Peeko asks for administrator rights so it can stay on top of games that run as administrator.
The exe is not code-signed, so Windows SmartScreen may show "Windows protected your PC": choose **More info > Run anyway**.

## Use
1. Open Peeko from the tray icon (look in the ^ overflow area if you don't see it).
2. Pick a skin, display and corner. Use **Add overlay** for more characters.
3. Turn on **Move mode** to drag an overlay, then turn it off so clicks reach your game.

**Adding skins:** press *Open skins folder*, drop your files in, then press *Rescan*.
Installed version: `%APPDATA%\Peeko\skins`. Portable version: the `skins` folder next to the exe.
Use transparent files (alpha) for a see-through look. Only add art you have the right to use.

**Fullscreen games:** the overlay shows over games in *Borderless* or *Fullscreen windowed* mode.
It cannot draw over true exclusive fullscreen.

## Privacy
Peeko makes no network connections and collects no data. It stores settings (`settings.json`) and a
diagnostic `log.txt` in `%APPDATA%\Peeko`. "Start with system" creates a Windows Task Scheduler task named
"Peeko" (removed by the uninstaller or by turning the option off).

## Build from source
Requires Node.js 20+ on Windows.
```
npm install
npm start          # run in development
npm run dist       # builds the installer and the portable exe into dist/
```
If the build fails with "Cannot create symbolic link", turn on Windows Developer Mode or run the terminal as administrator.
`npm run dist:user` builds a version that does not request administrator rights.

## License
MIT - see [LICENSE](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
