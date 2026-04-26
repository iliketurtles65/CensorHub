"""Thread-safe shared configuration for the censorship engine."""

import json
import threading
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ALL_LABELS = [
    "FEMALE_GENITALIA_COVERED",
    "FACE_FEMALE",
    "BUTTOCKS_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_BREAST_EXPOSED",
    "ANUS_EXPOSED",
    "FEET_EXPOSED",
    "BELLY_COVERED",
    "FEET_COVERED",
    "ARMPITS_COVERED",
    "ARMPITS_EXPOSED",
    "FACE_MALE",
    "BELLY_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "ANUS_COVERED",
    "FEMALE_BREAST_COVERED",
    "BUTTOCKS_COVERED",
]

DEFAULT_ENABLED = [
    "FEMALE_BREAST_EXPOSED",
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "BUTTOCKS_EXPOSED",
    "ANUS_EXPOSED",
]

CensorType = Literal["mosaic", "blur", "black_box", "pixelation", "image"]
CensorShape = Literal["rectangle", "ellipse", "rounded_rect"]
StretchMode = Literal["cover", "contain", "stretch"]

# Sentinel in a target list that means "every enabled category".
ALL_TARGET = "*"


def _default_targets() -> list[str]:
    return [ALL_TARGET]


def layer_applies(targets: list[str], class_name: str) -> bool:
    """True if `class_name` is covered by `targets` (includes ALL_TARGET wildcard)."""
    return ALL_TARGET in targets or class_name in targets


class StrokeLayer(BaseModel):
    enabled: bool = False
    color: str = "#ff0066"
    thickness: int = Field(default=2, ge=1, le=24)


class AssetAssignment(BaseModel):
    """Image asset + which detection categories it applies to.

    `targets` is a list of class names; the wildcard ALL_TARGET ('*') means
    every enabled category. Empty targets list = the asset is in the pool but
    doesn't render anywhere (same as not selecting it).
    """
    asset_id: str
    targets: list[str] = Field(default_factory=_default_targets)


class PhraseAssignment(BaseModel):
    """Phrase + which categories it applies to. Same target semantics as AssetAssignment."""
    phrase_id: str
    targets: list[str] = Field(default_factory=_default_targets)


class BaseImageLayer(BaseModel):
    """Used when censor_type == 'image'. Each assignment carries its own targets,
    so the user can map one image to FACE_FEMALE and another to BUTTOCKS_EXPOSED."""
    assignments: list[AssetAssignment] = Field(default_factory=list)
    stretch: StretchMode = "cover"


class OverlayImageLayer(BaseModel):
    """Composited on top of the base effect (+ stroke). Per-asset targets allow
    different images to target different categories."""
    enabled: bool = False
    assignments: list[AssetAssignment] = Field(default_factory=list)
    scale_pct: int = Field(default=80, ge=10, le=100)
    opacity: float = Field(default=1.0, ge=0.0, le=1.0)


class TextLayer(BaseModel):
    """Centered text inside the censor region. Per-phrase targets allow different
    phrases on different categories (e.g., 'CENSORED' on faces, 'NSFW' on bodies)."""
    enabled: bool = False
    assignments: list[PhraseAssignment] = Field(default_factory=list)
    font_id: str = "impact"
    color: str = "#ffffff"
    size_pct: int = Field(default=40, ge=10, le=100)
    stroke_enabled: bool = False
    stroke_color: str = "#000000"
    stroke_px: int = Field(default=0, ge=0, le=8)


class CensorSettings(BaseModel):
    # Ignore any stale per_category_* keys left over in on-disk config.json
    # from the previous scoped-override model.
    model_config = ConfigDict(extra="ignore")

    enabled_classes: list[str] = Field(default_factory=lambda: list(DEFAULT_ENABLED))
    censor_type: CensorType = "mosaic"
    intensity: int = Field(default=75, ge=0, le=100)
    confidence_threshold: float = Field(default=0.45, ge=0.0, le=1.0)
    master_size: float = Field(default=1.0, ge=0.5, le=2.0)
    master_shape: CensorShape = "rectangle"
    master_stroke: StrokeLayer = Field(default_factory=StrokeLayer)
    master_base_image: BaseImageLayer = Field(default_factory=BaseImageLayer)
    master_overlay_image: OverlayImageLayer = Field(default_factory=OverlayImageLayer)
    master_text: TextLayer = Field(default_factory=TextLayer)

    # Stroke keeps a single layer-level target list since it has one config
    # (color + thickness). Image/text targeting now lives on each assignment.
    stroke_targets: list[str] = Field(default_factory=_default_targets)

    # Per-category size multiplier overrides (sparse). Missing key = use master_size.
    per_category_size: dict[str, float] = Field(default_factory=dict)

    # Gaussian feather (in px) applied to the shape alpha mask.
    master_feather_px: int = Field(default=0, ge=0, le=32)


class GridSettings(BaseModel):
    folders: list[str] = Field(default_factory=list)
    layout_mode: Literal["puzzle", "2x2", "3x3", "4x4"] = "puzzle"
    density: int = Field(default=50, ge=0, le=100)
    audio_effects: list[str] = Field(default_factory=list)


class HypnoSettings(BaseModel):
    folders: list[str] = Field(default_factory=list)
    visual_effects: list[str] = Field(default_factory=list)
    audio_effects: list[str] = Field(default_factory=list)
    effect_intensity: int = Field(default=50, ge=0, le=100)
    speed: int = Field(default=50, ge=0, le=100)


class Phrase(BaseModel):
    id: str
    text: str


class ImageAsset(BaseModel):
    id: str
    filename: str
    path: str
    w: int
    h: int


class AppConfig(BaseModel):
    censor: CensorSettings = Field(default_factory=CensorSettings)
    grid: GridSettings = Field(default_factory=GridSettings)
    hypno: HypnoSettings = Field(default_factory=HypnoSettings)
    active_mode: Literal["censor", "grid", "hypno"] = "censor"
    censor_active: bool = False
    phrases: list[Phrase] = Field(default_factory=list)
    image_assets: list[ImageAsset] = Field(default_factory=list)


CONFIG_PATH = Path(__file__).parent.parent / "config.json"


class SharedConfig:
    """Thread-safe wrapper around AppConfig with file persistence."""

    def __init__(self):
        self._lock = threading.Lock()
        self._config = self._load()
        self._listeners: list[callable] = []
        self._version: int = 0

    def _load(self) -> AppConfig:
        if CONFIG_PATH.exists():
            try:
                data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                return AppConfig.model_validate(data)
            except Exception:
                pass
        return AppConfig()

    def _save(self, json_str: str):
        """Write config JSON to disk. Called outside the lock."""
        try:
            CONFIG_PATH.write_text(json_str, encoding="utf-8")
        except Exception:
            pass

    def get(self) -> AppConfig:
        with self._lock:
            return self._config.model_copy(deep=True)

    def get_version(self) -> int:
        return self._version

    def get_if_changed(self, known_version: int) -> tuple[AppConfig | None, int]:
        """Return (config_copy, version) only if version changed; else (None, known_version)."""
        v = self._version
        if v == known_version:
            return None, known_version
        with self._lock:
            return self._config.model_copy(deep=True), self._version

    def update_censor(self, **kwargs):
        with self._lock:
            data = self._config.censor.model_dump()
            data.update(kwargs)
            self._config.censor = CensorSettings.model_validate(data)
            self._version += 1
            json_str = self._config.model_dump_json(indent=2)
            cfg_copy = self._config.model_copy(deep=True)
        self._save(json_str)
        self._notify(cfg_copy)

    def update_grid(self, **kwargs):
        with self._lock:
            data = self._config.grid.model_dump()
            data.update(kwargs)
            self._config.grid = GridSettings.model_validate(data)
            self._version += 1
            json_str = self._config.model_dump_json(indent=2)
            cfg_copy = self._config.model_copy(deep=True)
        self._save(json_str)
        self._notify(cfg_copy)

    def update_hypno(self, **kwargs):
        with self._lock:
            data = self._config.hypno.model_dump()
            data.update(kwargs)
            self._config.hypno = HypnoSettings.model_validate(data)
            self._version += 1
            json_str = self._config.model_dump_json(indent=2)
            cfg_copy = self._config.model_copy(deep=True)
        self._save(json_str)
        self._notify(cfg_copy)

    def set_censor_active(self, active: bool):
        with self._lock:
            self._config.censor_active = active
            self._version += 1
            json_str = self._config.model_dump_json(indent=2)
            cfg_copy = self._config.model_copy(deep=True)
        self._save(json_str)
        self._notify(cfg_copy)

    def add_image_asset(self, asset: ImageAsset):
        with self._lock:
            # Dedupe by id
            self._config.image_assets = [a for a in self._config.image_assets if a.id != asset.id]
            self._config.image_assets.append(asset)
            self._version += 1
            json_str = self._config.model_dump_json(indent=2)
            cfg_copy = self._config.model_copy(deep=True)
        self._save(json_str)
        self._notify(cfg_copy)

    def remove_image_asset(self, asset_id: str):
        with self._lock:
            before = len(self._config.image_assets)
            self._config.image_assets = [a for a in self._config.image_assets if a.id != asset_id]
            if len(self._config.image_assets) == before:
                return
            self._version += 1
            json_str = self._config.model_dump_json(indent=2)
            cfg_copy = self._config.model_copy(deep=True)
        self._save(json_str)
        self._notify(cfg_copy)

    def set_phrases(self, phrases: list[Phrase]):
        with self._lock:
            self._config.phrases = list(phrases)
            self._version += 1
            json_str = self._config.model_dump_json(indent=2)
            cfg_copy = self._config.model_copy(deep=True)
        self._save(json_str)
        self._notify(cfg_copy)

    def set_active_mode(self, mode: str):
        with self._lock:
            self._config.active_mode = mode
            self._version += 1
            json_str = self._config.model_dump_json(indent=2)
            cfg_copy = self._config.model_copy(deep=True)
        self._save(json_str)
        self._notify(cfg_copy)

    def add_listener(self, callback: callable):
        self._listeners.append(callback)

    def _notify(self, cfg_copy):
        for cb in self._listeners:
            try:
                cb(cfg_copy)
            except Exception:
                pass

    def to_dict(self) -> dict:
        with self._lock:
            return self._config.model_dump()
