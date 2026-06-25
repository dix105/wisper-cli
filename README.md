# Wisper CLI

Clean CLI-first base for a Wispr Flow-style dictation tool.

## Base features

- CLI entrypoint: `wisper`
- Local transcript storage in `~/.wisper-cli/history.json`
- `wisper history` to print transcript history
- `wisper add "text"` to save a manual transcript while the base is being built
- `wisper app` / `wisper open` to launch a local web dashboard
- Local web dashboard at `http://127.0.0.1:3838`

## Not included in this base

- Meeting transcription
- Desktop/Tauri app shell
- Full recorder/hotkey implementation
- Cloud sync

## Planned next features

1. `wisper record` — record mic audio from CLI.
2. `wisper transcribe <file>` — transcribe audio file.
3. Provider adapters — Groq first, then ElevenLabs/Sarvam.
4. `wisper polish "text"` — rewrite dictated text.
5. Settings command + local config file.
6. Better history search/filter/copy in the web dashboard.
