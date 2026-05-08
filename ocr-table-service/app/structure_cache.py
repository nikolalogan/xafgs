import json
import shutil
from pathlib import Path


DEFAULT_STRUCTURE_REQUIRED_FILES = ("config.json", "preprocessor_config.json", "processor_config.json", "model.safetensors")
DEFAULT_STRUCTURE_CONFIG_NORMALIZED_FIELDS = {
    "dilation": False,
    "backbone": "resnet50",
    "use_pretrained_backbone": False,
}
DEFAULT_STRUCTURE_PROCESSOR_SIZE = {
    "shortest_edge": 800,
    "longest_edge": 800,
}


def ensure_default_structure_support_files(cache_dir: Path) -> None:
    preprocessor_config_path = cache_dir / "preprocessor_config.json"
    processor_config_path = cache_dir / "processor_config.json"
    if preprocessor_config_path.is_file() and not processor_config_path.is_file():
        shutil.copyfile(preprocessor_config_path, processor_config_path)


def find_missing_default_structure_files(cache_dir: Path) -> list[str]:
    return [name for name in DEFAULT_STRUCTURE_REQUIRED_FILES if not (cache_dir / name).is_file()]


def normalize_default_structure_config(cache_dir: Path) -> bool:
    config_path = cache_dir / "config.json"
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    changed = False
    for field, value in DEFAULT_STRUCTURE_CONFIG_NORMALIZED_FIELDS.items():
        if payload.get(field) is None:
            payload[field] = value
            changed = True
    if payload.get("use_timm_backbone") is False and payload.get("backbone_config") is not None:
        if payload.get("use_pretrained_backbone") is not False:
            payload["use_pretrained_backbone"] = False
            changed = True
        if payload.get("dilation") is None:
            payload["dilation"] = False
            changed = True
    if changed:
        config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed


def normalize_default_structure_processor_configs(cache_dir: Path) -> bool:
    changed = False
    for name in ("preprocessor_config.json", "processor_config.json"):
        config_path = cache_dir / name
        payload = json.loads(config_path.read_text(encoding="utf-8"))
        if payload.get("size") != DEFAULT_STRUCTURE_PROCESSOR_SIZE:
            payload["size"] = dict(DEFAULT_STRUCTURE_PROCESSOR_SIZE)
            config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            changed = True
    return changed
