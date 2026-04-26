"""FastAPI + WebSocket server for frontend communication."""

import asyncio
import json
import logging
import os
import threading
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

import uvicorn
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from .config import ALL_LABELS, ImageAsset, Phrase, SharedConfig
from .overlay.asset_store import AssetStore

logger = logging.getLogger(__name__)

MEDIA_EXTENSIONS = {
    ".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v",
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
}


def create_app(config: SharedConfig, asset_store: AssetStore | None = None) -> FastAPI:
    app = FastAPI(title="Censor Backend")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    connected_clients: list[WebSocket] = []
    status_data = {"active": False, "fps": 0, "detections": 0}

    async def broadcast(message: dict):
        dead = []
        for ws in connected_clients:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            connected_clients.remove(ws)

    @app.get("/api/config")
    async def get_config():
        return JSONResponse(config.to_dict())

    @app.get("/api/labels")
    async def get_labels():
        return JSONResponse({"labels": ALL_LABELS})

    @app.get("/api/fonts")
    async def get_fonts():
        from .overlay.text_cache import available_fonts
        return JSONResponse({"fonts": available_fonts()})

    @app.get("/api/media/scan")
    async def scan_folders(folders: str):
        """Scan folders for media files. folders is comma-separated paths."""
        folder_list = [f.strip() for f in folders.split(",") if f.strip()]
        files = []
        for folder in folder_list:
            folder_path = Path(folder)
            if not folder_path.is_dir():
                continue
            for f in folder_path.rglob("*"):
                if f.suffix.lower() in MEDIA_EXTENSIONS and f.is_file():
                    files.append({
                        "path": str(f),
                        "name": f.name,
                        "type": "video" if f.suffix.lower() in {
                            ".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v"
                        } else "image",
                        "size": f.stat().st_size,
                    })
        return JSONResponse({"files": files})

    @app.post("/api/assets/image")
    async def upload_image(file: UploadFile = File(...)):
        if asset_store is None:
            return JSONResponse({"error": "asset store not available"}, status_code=503)
        raw = await file.read()
        try:
            rec = asset_store.save_upload(file.filename or "upload", raw)
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        except Exception as e:
            logger.error("Asset upload failed: %s", e, exc_info=True)
            return JSONResponse({"error": "upload failed"}, status_code=500)
        asset = ImageAsset(id=rec.id, filename=rec.filename, path=rec.path, w=rec.w, h=rec.h)
        config.add_image_asset(asset)
        await broadcast({"type": "config.updated", "data": {"image_assets": [a.model_dump() for a in config.get().image_assets]}})
        return JSONResponse(asset.model_dump())

    @app.delete("/api/assets/image/{asset_id}")
    async def delete_image(asset_id: str):
        if asset_store is None:
            return JSONResponse({"error": "asset store not available"}, status_code=503)
        asset_store.delete(asset_id)
        config.remove_image_asset(asset_id)
        # Also scrub the id from any layer pools in master + per-category.
        _scrub_asset_from_layers(config, asset_id)
        await broadcast({"type": "config.updated", "data": {"image_assets": [a.model_dump() for a in config.get().image_assets]}})
        return JSONResponse({"ok": True})

    @app.get("/api/assets/image/{asset_id}/raw")
    async def serve_image(asset_id: str):
        if asset_store is None:
            return JSONResponse({"error": "asset store not available"}, status_code=503)
        p = asset_store.root / f"{asset_id}.png"
        if not p.is_file():
            return JSONResponse({"error": "not found"}, status_code=404)
        return FileResponse(str(p), media_type="image/png")

    @app.get("/api/assets/image/{asset_id}/thumb")
    async def serve_image_thumb(asset_id: str):
        import cv2
        if asset_store is None:
            return JSONResponse({"error": "asset store not available"}, status_code=503)
        src = asset_store.get_raw(asset_id)
        if src is None:
            return JSONResponse({"error": "not found"}, status_code=404)
        thumb = asset_store.get_resized(asset_id, 128, 128, "contain")
        if thumb is None:
            return JSONResponse({"error": "thumb failed"}, status_code=500)
        ok, buf = cv2.imencode(".png", thumb)
        if not ok:
            return JSONResponse({"error": "encode failed"}, status_code=500)
        return Response(content=buf.tobytes(), media_type="image/png")

    @app.get("/api/media/file")
    async def serve_media_file(path: str):
        """Serve a local media file by path."""
        file_path = Path(unquote(path))
        if not file_path.is_file():
            return JSONResponse({"error": "File not found"}, status_code=404)
        return FileResponse(
            str(file_path),
            media_type=_get_media_type(file_path.suffix.lower()),
        )

    @app.websocket("/ws")
    async def websocket_endpoint(ws: WebSocket):
        await ws.accept()
        connected_clients.append(ws)
        logger.info("WebSocket client connected (%d total)", len(connected_clients))

        # Send initial config
        await ws.send_json({
            "type": "config.full",
            "data": config.to_dict(),
        })

        try:
            while True:
                raw = await ws.receive_text()
                msg = json.loads(raw)
                await _handle_message(msg, config, ws, broadcast, status_data)
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error("WebSocket error: %s", e)
        finally:
            if ws in connected_clients:
                connected_clients.remove(ws)
            logger.info("WebSocket client disconnected (%d total)", len(connected_clients))

    # Expose broadcast and status for the engine to call
    app.state.broadcast = broadcast
    app.state.status_data = status_data
    app.state.connected_clients = connected_clients

    return app


async def _handle_message(msg, config, ws, broadcast, status_data):
    msg_type = msg.get("type", "")
    data = msg.get("data", {})

    if msg_type == "censor.start":
        try:
            config.set_censor_active(True)
        except Exception as e:
            logger.warning("censor.start failed: %s", e)
            await ws.send_json({"type": "error", "data": {"message": str(e)}})
            return
        status_data["active"] = True
        await broadcast({"type": "censor.status", "data": status_data})

    elif msg_type == "censor.stop":
        try:
            config.set_censor_active(False)
        except Exception as e:
            logger.warning("censor.stop failed: %s", e)
            await ws.send_json({"type": "error", "data": {"message": str(e)}})
            return
        status_data["active"] = False
        await broadcast({"type": "censor.status", "data": status_data})

    elif msg_type == "censor.settings":
        try:
            config.update_censor(**data)
        except Exception as e:
            logger.warning("Invalid censor settings: %s", e)
            await ws.send_json({"type": "error", "data": {"message": str(e)}})
            return
        await broadcast({"type": "config.updated", "data": {"censor": data}})

    elif msg_type == "phrases.update":
        try:
            phrases = [Phrase(**p) for p in data.get("phrases", [])]
            config.set_phrases(phrases)
        except Exception as e:
            logger.warning("Invalid phrases: %s", e)
            await ws.send_json({"type": "error", "data": {"message": str(e)}})
            return
        await broadcast({"type": "config.updated", "data": {"phrases": [p.model_dump() for p in phrases]}})

    elif msg_type == "grid.settings":
        try:
            config.update_grid(**data)
        except Exception as e:
            logger.warning("Invalid grid settings: %s", e)
            await ws.send_json({"type": "error", "data": {"message": str(e)}})
            return
        await broadcast({"type": "config.updated", "data": {"grid": data}})

    elif msg_type == "hypno.settings":
        try:
            config.update_hypno(**data)
        except Exception as e:
            logger.warning("Invalid hypno settings: %s", e)
            await ws.send_json({"type": "error", "data": {"message": str(e)}})
            return
        await broadcast({"type": "config.updated", "data": {"hypno": data}})

    elif msg_type == "mode.switch":
        mode = data.get("mode", "censor")
        try:
            config.set_active_mode(mode)
        except Exception as e:
            logger.warning("mode.switch failed: %s", e)
            await ws.send_json({"type": "error", "data": {"message": str(e)}})
            return
        await broadcast({"type": "mode.switched", "data": {"mode": mode}})

    elif msg_type == "media.scan_folders":
        folders = data.get("folders", [])
        files = []
        for folder in folders:
            folder_path = Path(folder)
            if not folder_path.is_dir():
                continue
            for f in folder_path.rglob("*"):
                if f.suffix.lower() in MEDIA_EXTENSIONS and f.is_file():
                    files.append({
                        "path": str(f),
                        "name": f.name,
                        "type": "video" if f.suffix.lower() in {
                            ".mp4", ".webm", ".mkv", ".avi", ".mov",
                            ".wmv", ".flv", ".m4v"
                        } else "image",
                        "size": f.stat().st_size,
                    })
        await ws.send_json({"type": "media.file_list", "data": {"files": files}})


def _scrub_asset_from_layers(config: SharedConfig, asset_id: str) -> None:
    """Remove a deleted image asset id from master overlay + base image assignments."""
    cfg = config.get()
    changed = False

    ov = cfg.censor.master_overlay_image
    before = len(ov.assignments)
    ov.assignments = [a for a in ov.assignments if a.asset_id != asset_id]
    if len(ov.assignments) != before:
        changed = True

    base = cfg.censor.master_base_image
    before = len(base.assignments)
    base.assignments = [a for a in base.assignments if a.asset_id != asset_id]
    if len(base.assignments) != before:
        changed = True

    if changed:
        config.update_censor(**cfg.censor.model_dump())


def _get_media_type(ext: str) -> str:
    types = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
        ".mov": "video/quicktime",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    return types.get(ext, "application/octet-stream")


class ServerThread(threading.Thread):
    """Runs the FastAPI server in a background thread."""

    def __init__(self, config: SharedConfig, host: str = "127.0.0.1", port: int = 9099,
                 asset_store: AssetStore | None = None):
        super().__init__(daemon=True, name="WSServerThread")
        self.config = config
        self.host = host
        self.port = port
        self.asset_store = asset_store
        self.app: Optional[FastAPI] = None
        self._server: Optional[uvicorn.Server] = None

    def run(self):
        self.app = create_app(self.config, self.asset_store)
        uvi_config = uvicorn.Config(
            self.app,
            host=self.host,
            port=self.port,
            log_level="warning",
            ws="websockets",
        )
        self._server = uvicorn.Server(uvi_config)
        self._server.run()

    def stop(self):
        if self._server:
            self._server.should_exit = True
