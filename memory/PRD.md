# PRD — Batch AI Image Generator (Grok)

## Problem Statement
Personal single-page tool: paste a numbered list of image prompts, generate one image per line sequentially via the Grok (xAI) image API, watch progress, and download images (zero-padded PNGs) individually or as a ZIP. No login, no database, images clear on refresh.

## Architecture
- **Backend** (`/app/backend/server.py`): FastAPI proxy. `GET /api/config` (reports if key set), `POST /api/generate` {prompt} → returns base64 data URL. Calls xAI `POST https://api.x.ai/v1/images/generations`, model `grok-imagine-image-2.0`, `response_format=b64_json`. Key held server-side via `XAI_API_KEY` env var (never exposed to browser).
- **Frontend** (`/app/frontend/src/App.js`): split-screen dark tool. Left = numbered-prompt textarea + Generate All. Right = scrollable image feed. Sequential generation loop (one at a time), progress bar "GENERATING x/N", per-image download/regenerate, Download-All-as-ZIP via JSZip. Zero-padded filenames (01.png…).
- Design: `design_guidelines.json` — Swiss/high-contrast dark, Chivo + JetBrains Mono.

## Implemented (2026-06)
- Numbered-prompt parsing (tolerant of `1.`, `1)`, `1:` etc.)
- Sequential generation with live progress + Stop button
- Per-item states: queued / generating / done / failed
- Error handling: failed prompt shows red FAILED marker + reason, batch continues (verified)
- Download single PNG + Download All as ZIP (zero-padded)
- Regenerate per image
- Server key-missing warning banner + `/api/config`

## Status / Notes
- **UNVERIFIED**: actual image generation not tested end-to-end — requires a valid `XAI_API_KEY` (user did not have one yet). All other flows verified via UI.
- To enable: put key in `backend/.env` `XAI_API_KEY=...`, restart backend. Get key at https://accounts.x.ai (Console → API Keys), requires credits.

## Backlog
- P1: Aspect-ratio / resolution selector
- P2: Persist batch across refresh (localStorage)
- P2: Concurrency toggle (parallel N)
