# Wisper CLI Completion Plan

Goal: after `wisper setup`, the user can press the configured shortcut, speak, get transcription, and have history/web review available. No meeting mode.

## UX contract

```bash
wisper setup
```

Flow:
1. Select model from menu.
2. Paste API key.
3. Verify API key.
4. Choose shortcut, default `Ctrl+Alt+Space`.
5. Choose autostart yes/no.
6. Start background listener immediately.

After setup:
- User presses shortcut.
- Wisper starts recording and shows terminal/log feedback.
- User presses shortcut again to stop.
- Wisper transcribes with selected model.
- Transcript is saved to history.
- Later: text is pasted into focused app.

## Milestone 1 — listener lifecycle

- Setup starts listener automatically. ✅
- Autostart launches `wisper listen`. ✅
- Add log file: `~/.wisper-cli/wisper.log`.
- Add `wisper stop` and `wisper restart`.
- Add status field showing listener PID/running state.

## Milestone 2 — Windows global shortcut

- Implement Windows/macOS global hotkey via `node-global-key-listener`. ✅
- Normalize shortcut strings like `Ctrl+Alt+Space`. ✅
- Register shortcut in background listener. ✅
- On key press, toggle recording state. ✅
- Print/log clear states: `recording`, `transcribing`, `done`, `error`. ✅

## Milestone 3 — microphone recording

- Request/use microphone from listener process via SoX-backed recorder. ✅
- Save temporary WAV under `~/.wisper-cli/tmp`. ✅
- Recording mode: press once start, press again stop. ✅
- Add fallback command: `wisper record` for debugging without hotkey.

## Milestone 4 — transcription providers

- Implement provider interface. ✅
- Groq first: `whisper-large-v3-turbo`. ✅
- ElevenLabs second: `scribe_v2`. ✅
- Sarvam third. ✅
- Add `wisper transcribe <file>`. ✅
- Save transcript to history. ✅

## Milestone 5 — paste into active app

- Windows paste first: write transcript to clipboard, send Ctrl+V. ✅
- macOS paste: clipboard + Command+V via System Events. ✅
- Add setting to only print/save instead of paste.
- Add error recovery: if paste fails, transcript remains in history.

## Milestone 6 — local web dashboard

- Show history.
- Search/filter history.
- Copy transcript.
- Delete transcript.
- Show current provider/model/shortcut/listener state.

## Technical direction

Keep it simple:
- TypeScript CLI for setup/config/history/web.
- Platform-specific helper for hotkey/mic/paste if Node packages are unreliable.
- Windows first because current user testing is on Windows.
- No desktop app until CLI flow works end-to-end.
