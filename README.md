# Censor — Real-Time Content Censorship Engine

GPU-accelerated, low-latency desktop overlay that detects and censors
NSFW regions in real time using ONNX inference and a transparent
click-through overlay window. Backend is Python (FastAPI + PySide6 +
onnxruntime-gpu); frontend is Electron + React + Three.js.

## Features

- Real-time screen capture at 60 FPS (dxcam) with bounding-box detection
- Configurable censor styles: mosaic, blur, black box, pixelation, image overlay
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
`<SOURCE_URL_TBD>` and place it at:

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
