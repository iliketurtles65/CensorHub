## Support this and future projects! ☕

<a href="https://buymeacoffee.com/iliketurtles6565">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" height="50" />
</a>

# Censor — Real-Time Content Censorship Engine

GPU-accelerated, low-latency desktop overlay that detects and censors NSFW regions in real time 
Choose from different censorship types
Customize your censors with stroke, text, or image overlays

# Grid — Wall Feature

Wall feature allows users to open multiple directories of videos/images and have them in a wall
Audio DSP effects can be added to enhance the experience. 
Choose from different grids (puzzle/4x4 etc) or click individual squares to swap content

# Hypno — Hypno Effects for Specified Directories of Content

Hypno tab allows users to produce hypno spirals with varying effects
Content, text, and audio effects can be added here 
Users can click screen to change content being displayed

## Features

- Real-time screen capture at 60 FPS  with bounding-box detection
- Configurable censor styles: mosaic, blur, black box, pixelation, image overlay
- Configurable content wall settings: choose amount of content displayed at once, audio effects, etc
- Configurable hypno settings: finetune your ideal hypno spiral and text overlays to content you choose
- Per-category targeting — image, text, and stroke layers each map to specific detection classes
- Cyberpunk-themed UI with live config and three modes (Censor / Grid / Hypno)
- WebSocket bridge between frontend and backend at `ws://127.0.0.1:9099/ws`

## System Requirements

- **OS**: Windows 11 (PySide6 + dxcam are Windows-targeted; the backend registers Windows DPI APIs at startup)
- **GPU**: NVIDIA GPU with a CUDA 12.x driver (onnxruntime-gpu)
- **Python**: 3.11+
- **Node.js**: 18+ (for the Electron frontend)

## First-Time Setup

### 1. Clone

```
git clone <repository-url>
cd <repository-folder>
```

### 2. Backend — Python venv + dependencies

```
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

### 3. Frontend — npm install

```
cd frontend
npm install
cd ..
```

### 4. Download the detection model

The detector uses a YOLO-class ONNX model (`640m.onnx`, ~99 MB).
It is **not bundled** in the repo. Download it from
[![Download Model](https://img.shields.io/badge/Download-640m.onnx-blue?style=for-the-badge&logo=github)](https://github.com/notAI-tech/NudeNet/releases/download/v3.4-weights/640m.onnx) 
or alternative repo link [NuDeNet Repository](https://github.com/notAI-tech/NudeNet)

create a models folder and place the onnx file at:

```
backend/models/640m.onnx
```

The model uses the NudeNet class taxonomy — see
`backend/src/config.py` for the full label list.

## Running

With both backend and frontend installed:

```
start.bat
```

This launches the backend (port 9099) in one console and the Electron
dev server in another. Close the launcher window once both are up;
they keep running until you exit the app.

### Manual run (without `start.bat`)

Backend:

```
cd backend
venv\Scripts\activate
python -m src.main
```

Frontend (separate terminal):

```
cd frontend
npm run dev
```

## Configuration

On first launch the app generates `backend/config.json` with sensible
defaults. Use the in-app UI to enable detection classes, choose a
censor style, manage phrases, and upload image overlays. Your config
is local and not committed.

## Project Layout

```
backend/      Python — capture, inference, tracking, overlay, ws server
  src/
    main.py         entry point
    ws_server.py    FastAPI + WebSocket
    capture/        dxcam screen capture, frame buffers
    inference/      onnxruntime detector + pre/post-processing
    tracking/       smoothing/tracker
    overlay/        PySide6 transparent overlay window + render worker
    media/          file server for image assets
frontend/     Electron + React + Three.js + Tailwind UI
```

## Building a Release (frontend)

```
cd frontend
npm run build
```

## License

PolyForm Noncommercial 1.0.0 — see `LICENSE`.
You may use, modify, and share this software freely for non-commercial
purposes. Commercial use is not permitted.

## Acknowledgements

- Detection model based on the NudeNet class taxonomy.
- Built with onnxruntime, FastAPI, PySide6, Electron, React, Three.js, and Tailwind.
