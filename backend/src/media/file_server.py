"""Media file serving endpoints (included in the main FastAPI app)."""

# Media serving is handled directly in ws_server.py via the /api/media/* endpoints.
# This module is reserved for future ffmpeg transcoding support.

from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS


def scan_folder(folder_path: str) -> list[dict]:
    """Scan a folder recursively for media files."""
    folder = Path(folder_path)
    if not folder.is_dir():
        return []

    files = []
    for f in folder.rglob("*"):
        ext = f.suffix.lower()
        if ext in MEDIA_EXTENSIONS and f.is_file():
            files.append({
                "path": str(f),
                "name": f.name,
                "type": "video" if ext in VIDEO_EXTENSIONS else "image",
                "size": f.stat().st_size,
            })
    return files
