# NitroScribe – developer notes

Electron 44 + electron-vite 6 + React 19 + Tailwind 4 + TipTap 3. Windows-first. MIT licensed.

## Commands

- `npm run dev`: run with hot reload
- `npm run build`: production build into `out/`
- `npm start`: run the production build
- `npm run typecheck`: `tsc` for main/preload (`tsconfig.node.json`) and renderer (`tsconfig.web.json`)
- `npm test`: unit tests (vitest, `test/*.test.ts`)
- `npm run dist`: typecheck, build, and create the NSIS installer in `dist/`. `npm run dist:dir` skips the installer.
- `python scripts/make-icons.py` (needs Pillow) regenerates every icon from `build/icon-source.png` with squircle corners: app/installer icon, window icon, in-app logo, and tray icons.
- Releases: publishing a GitHub Release (web UI or `gh release create`) runs `.github/workflows/release.yml`. It builds the installer at the release tag's version and attaches it plus `SHA256SUMS.txt`, unless the release already has an `.exe`. It can also be run manually for a tag. CI (`ci.yml`) runs typecheck and unit tests on every push. Actions are pinned by commit SHA.

Integration tests need the whisper.cpp CUDA build and models in `%TEMP%\whisper-bench`, plus the voice model in `%TEMP%\spk`:
- `INTEGRATION=1 npx vitest run test/integration/session.test.ts`: speaker attribution and echo
- `INTEGRATION=1 npx vitest run test/integration/diarization.test.ts`: 4-person call with LibriSpeech voices (purity + WER)
- `INTEGRATION=1 REALTIME=1 npx vitest run test/integration/realtime.test.ts`: real-time load (set `MODEL=` to compare models)

End-to-end (Playwright driving the built app; screenshots go to `%TEMP%\nitroscribe-shots`):
- `node scripts/e2e.mjs ui|full|import|onboarding|install|packaged`
- `full` and `import` use a local Ollama model (`OLLAMA_MODEL`, default `llama3.2:3b-instruct-q4_K_M`).
- `packaged` runs `dist/win-unpacked` (or `APP_EXE`) against the engine installed in `%APPDATA%\NitroScribe`. Release builds disable the inspector fuse, which Playwright needs, so build the test copy with `npx electron-builder --win --x64 --dir -c.electronFuses.enableNodeCliInspectArguments=true`.

## macOS

- Built only in CI (`mac` job in `release.yml`, `macos-latest`, arm64). The job compiles `whisper-server` from whisper.cpp tag `b5454` with Metal into `whisper-bin/mac/`, which electron-builder bundles as `Resources/whisper`. The app is ad-hoc signed (`identity: '-'`, hardened runtime off) and not notarized.
- `WhisperManager` uses the bundled binary on darwin (override with `NITROSCRIBE_WHISPER_BIN`) and only downloads models. `status.binary` is `'metal'`.
- System audio relies on Chromium's ScreenCaptureKit loopback (`MacLoopbackAudioForScreenShare` feature switch) and is untested; without it the recorder falls back to mic-only.
- Window: native traffic lights (`trafficLightPosition`), `[data-platform=darwin]` CSS swaps the caption-button gap for a traffic-light gap; ⌘ works for all shortcuts.

## Environment gotchas

- Terminals inside Electron apps can set `ELECTRON_RUN_AS_NODE=1`, which makes `electron .` run as plain Node (`app` is undefined). Unset it before `npm run dev`. The e2e script does this itself.
- If `CUDA_VISIBLE_DEVICES` is set globally (it is on the original dev machine), CUDA tools can't see the only GPU. The app removes that variable when spawning `whisper-server` and selects the GPU with `-dev`.
- Windows' Power saver plan makes transcription several times slower. The app detects it (by GUID) and warns once.
- On a 4 GB GPU, Whisper and a local LLM compete for VRAM, so the app stops `whisper-server` when a recording ends if the AI provider is local. Ollama reloads the model whenever `num_ctx` changes, so context sizes snap to fixed steps.
- whisper.cpp's built-in Silero VAD (`--vad`) gets slower with every request in release b5454, so it is disabled. Our own energy VAD plus window packing replaces it.
- `NITROSCRIBE_DATA_DIR` overrides the data folder (used by tests).
- Pin new dependencies to versions published at least 7 days ago.

## Privacy model

- `settings.privacy.localOnly` (default on): `AiService.llm()` refuses any provider URL that isn't loopback, private network, or `*.local` (`src/shared/net.ts`). Every AI request goes through it.
- The renderer session blocks all http/https/ws requests (`webRequest.onBeforeRequest`), except the Vite dev server during development.
- Only the main process does network I/O: AI, iCal fetch, and model downloads (SHA-256 pinned in `src/shared/whisperModels.ts`).
- Logs never contain transcript text, API keys or settings values (only the names of changed settings).
- Electron fuses (`electron-builder.yml`): no RunAsNode, no `NODE_OPTIONS`, no `--inspect`, ASAR integrity validation, app loads only from ASAR. Check with `node node_modules/@electron/fuses/dist/bin.js read --app dist/win-unpacked/NitroScribe.exe`.

## Architecture

- `src/main/transcription/`: per-channel VAD, echo gate, packing into ≤28 s Whisper windows, word→speaker mapping, hallucination filters
- `src/main/speakers/`: CAM++ voice embeddings (sherpa-onnx, in a worker thread), online clustering + end-of-meeting refinement, voice library
- Uploaded recordings: the renderer decodes them with `OfflineAudioContext.decodeAudioData` at 16 kHz (`lib/audio.ts`, so any codec Chromium knows works) and streams 30 s PCM chunks to `RecordingController.startFile/pushFile/finishFile`. That runs a normal `TranscriptionSession` with all audio on the "them" channel (so voices get separated), and progress arrives as `import:audioProgress`. Only one recording or file job runs at a time. e2e: `node scripts/e2e.mjs audio` (needs ffmpeg on PATH).
- Action items: `AiService.extractActionItems` runs after notes are written (`ai.autoActionItems`). It asks the model for JSON (`actionItemsPrompt`), then `refineActionItems` fixes small-model mistakes deterministically: owners from "Name: task" or the notes' Next steps bullets, deadlines via `shared/dueDates.resolveDue` (relative to the meeting date), invented times dropped, duplicates removed. Items live on `meeting.actionItems` and in `MeetingSummary`. `shared/calendarExport.ts` builds Google Calendar template links and `.ics` files (no Google API). e2e: `node scripts/e2e.mjs actions`.
- `src/main/import/`: transcript import. Covers VTT, SRT, the Teams `.docx` format (minimal ZIP reader), Otter/Meet/"Name: text" plain text, and NitroScribe and other JSON exports. Missing timestamps are estimated.
- `src/main/whisper/`: download/verify/extract whisper.cpp and models; manage `whisper-server`
- `src/main/ai/`: LLM providers (OpenAI-compatible, Anthropic, Ollama native), prompts, retrieval for cross-meeting chat
- `src/renderer/`: UI; `lib/recorder.ts` captures mic plus WASAPI loopback, merged into a 2-channel AudioWorklet at 16 kHz
