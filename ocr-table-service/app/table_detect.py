from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image

from app.table_extract_shared import (
    DEFAULT_LAYOUT_MODEL,
    TABLE_LABEL,
    DetectionBox,
    TableExtractError,
    bbox_iou,
    ensure_layout_model_source,
    resolve_layout_cache_dir,
    resolve_layout_model_name,
)


class DocLayoutYoloDetector:
    def __init__(self, model_id: str, cache_dir: str, model_source: str) -> None:
        self.model_id = model_id
        self.cache_dir = cache_dir
        self.model_source = model_source
        self._model = None

    def _load(self) -> Any:
        if self._model is not None:
            return self._model
        local_files_only = Path(self.model_source).is_dir()
        try:
            from transformers import AutoImageProcessor, TableTransformerForObjectDetection
        except Exception as exc:
            raise TableExtractError("TATR detection 依赖未就绪，请安装 `transformers`、`torch`、`torchvision`") from exc
        try:
            processor = AutoImageProcessor.from_pretrained(
                self.model_source,
                cache_dir=self.cache_dir,
                local_files_only=local_files_only,
            )
            model = TableTransformerForObjectDetection.from_pretrained(
                self.model_source,
                cache_dir=self.cache_dir,
                local_files_only=local_files_only,
            )
            model.eval()
            self._model = (processor, model)
        except Exception as exc:
            raise TableExtractError(
                f"TATR detection 模型加载失败: model={self.model_id}, source={self.model_source}, "
                f"cache_dir={self.cache_dir}, detail={exc}"
            ) from exc
        return self._model

    def detect(self, image: Image.Image, threshold: float) -> list[DetectionBox]:
        processor, model = self._load()
        try:
            import torch
        except Exception as exc:
            raise TableExtractError("TATR detection 依赖未就绪，请安装 `torch`") from exc
        try:
            inputs = processor(images=image, return_tensors="pt")
            with torch.no_grad():
                outputs = model(**inputs)
            target_sizes = torch.tensor([[image.height, image.width]])
            result = processor.post_process_object_detection(outputs, threshold=threshold, target_sizes=target_sizes)[0]
        except Exception as exc:
            raise TableExtractError(f"TATR detection 推理失败: {exc}") from exc
        id2label = getattr(model.config, "id2label", {}) or {}
        detections: list[DetectionBox] = []
        for bbox, score, label_id in zip(result["boxes"].tolist(), result["scores"].tolist(), result["labels"].tolist()):
            label = str(id2label.get(int(label_id), label_id)).strip().lower()
            if label not in {TABLE_LABEL, "table rotated"}:
                continue
            detections.append(DetectionBox(label=label, score=float(score), bbox=[float(value) for value in bbox]))
        return detections


@lru_cache(maxsize=1)
def get_layout_detector() -> DocLayoutYoloDetector:
    model_name = resolve_layout_model_name()
    source = ensure_layout_model_source(model_name) if model_name == DEFAULT_LAYOUT_MODEL else model_name
    return DocLayoutYoloDetector(
        model_id=model_name,
        cache_dir=resolve_layout_cache_dir(),
        model_source=source,
    )


def nms_detections(detections: list[DetectionBox], iou_threshold: float) -> list[DetectionBox]:
    ordered = sorted(detections, key=lambda item: item.score, reverse=True)
    kept: list[DetectionBox] = []
    while ordered:
        current = ordered.pop(0)
        kept.append(current)
        ordered = [item for item in ordered if bbox_iou(item.bbox, current.bbox) < iou_threshold]
    return kept


def sort_boxes_top_left(boxes: list[DetectionBox]) -> list[DetectionBox]:
    return sorted(boxes, key=lambda item: (round(item.bbox[1] / 8.0), item.bbox[0], item.bbox[1]))
