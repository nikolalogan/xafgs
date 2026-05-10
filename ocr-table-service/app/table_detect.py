from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image

from app.table_extract_shared import (
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
        try:
            from doclayout_yolo import YOLOv10
        except Exception as exc:
            raise TableExtractError("DocLayout-YOLO 依赖未就绪，请安装 `doclayout-yolo` 及其运行时依赖") from exc
        try:
            if Path(self.model_source).is_file():
                self._model = YOLOv10(self.model_source)
            else:
                self._model = YOLOv10.from_pretrained(self.model_source, cache_dir=self.cache_dir)
        except Exception as exc:
            raise TableExtractError(
                f"DocLayout-YOLO 模型加载失败: model={self.model_id}, source={self.model_source}, "
                f"cache_dir={self.cache_dir}, detail={exc}"
            ) from exc
        return self._model

    def detect(self, image: Image.Image, threshold: float) -> list[DetectionBox]:
        model = self._load()
        try:
            result = model.predict(image, conf=threshold, verbose=False)[0]
        except Exception as exc:
            raise TableExtractError(f"DocLayout-YOLO 推理失败: {exc}") from exc
        names = getattr(result, "names", {}) or {}
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            return []
        detections: list[DetectionBox] = []
        for bbox, score, cls_index in zip(boxes.xyxy.tolist(), boxes.conf.tolist(), boxes.cls.tolist()):
            label = str(names.get(int(cls_index), cls_index)).strip().lower()
            if label != TABLE_LABEL:
                continue
            detections.append(DetectionBox(label=label, score=float(score), bbox=[float(value) for value in bbox]))
        return detections


@lru_cache(maxsize=1)
def get_layout_detector() -> DocLayoutYoloDetector:
    model_name = resolve_layout_model_name()
    return DocLayoutYoloDetector(
        model_id=model_name,
        cache_dir=resolve_layout_cache_dir(),
        model_source=ensure_layout_model_source(model_name),
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
