import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from fastapi.testclient import TestClient

from app.service import app
from app.structure_cache import (
    normalize_default_structure_config,
    normalize_default_structure_processor_configs,
)
from app.table_extract_shared import ensure_layout_model_source, ensure_structure_model_source
from app.table_extract import TableExtractError


class TableExtractRouteTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_route_returns_result_and_duration(self) -> None:
        with mock.patch(
            "app.service.extract_tables",
            return_value={
                "provider": "table-extract-v1",
                "pages": [
                    {
                        "tables": [
                            {
                                "meta": {
                                    "rectified": False,
                                    "rectifyMode": "fallback_none",
                                    "rotationApplied": 0,
                                    "originalCropWidth": 100,
                                    "originalCropHeight": 50,
                                    "deskewAngle": 0.0,
                                    "quadScore": 0.0,
                                    "lineCoverageHorizontal": 0.0,
                                    "lineCoverageVertical": 0.0,
                                }
                            }
                        ]
                    }
                ],
            },
        ):
            response = self.client.post("/table-extract", json={"file": "ZmFrZQ=="})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["provider"], "table-extract-v1")
        self.assertIn("durationMs", body)
        self.assertIn("rectifyMode", body["pages"][0]["tables"][0]["meta"])

    def test_route_maps_dependency_error_to_503(self) -> None:
        with mock.patch("app.service.extract_tables", side_effect=TableExtractError("依赖未就绪: missing torch")):
            response = self.client.post("/table-extract", json={"file": "ZmFrZQ=="})
        self.assertEqual(response.status_code, 503)
        self.assertIn("依赖未就绪", response.json()["detail"])

    def test_route_maps_validation_like_error_to_422(self) -> None:
        with mock.patch("app.service.extract_tables", side_effect=TableExtractError("file 不能为空")):
            response = self.client.post("/table-extract", json={"file": ""})
        self.assertEqual(response.status_code, 422)
        self.assertIn("file 不能为空", response.json()["detail"])


class LazyModelResolutionTestCase(unittest.TestCase):
    def test_layout_model_source_raises_actionable_error_when_default_cache_missing(self) -> None:
        with mock.patch("app.table_extract_shared.resolve_layout_cache_dir", return_value="/app/model_cache/table_extract/layout"):
            with mock.patch("pathlib.Path.is_file", return_value=False):
                with self.assertRaises(TableExtractError) as ctx:
                    ensure_layout_model_source("microsoft/table-transformer-detection")
        message = str(ctx.exception)
        self.assertIn("模型在首次使用时不可用", message)
        self.assertIn("missing_files", message)
        self.assertIn("make ocr-table-detection-model-cache-warm", message)

    def test_structure_model_source_raises_actionable_error_when_default_cache_missing(self) -> None:
        with mock.patch("app.table_extract_shared.resolve_structure_cache_dir", return_value="/app/model_cache/table_extract/structure"):
            with mock.patch("pathlib.Path.is_file", return_value=False):
                with self.assertRaises(TableExtractError) as ctx:
                    ensure_structure_model_source("microsoft/table-transformer-structure-recognition")
        message = str(ctx.exception)
        self.assertIn("模型在首次使用时不可用", message)
        self.assertIn("missing_files", message)
        self.assertIn("make ocr-table-model-cache-warm", message)


class TableTransformerRecognizerTestCase(unittest.TestCase):
    def test_default_structure_model_files_include_processor_config(self) -> None:
        from app.table_extract import DEFAULT_STRUCTURE_MODEL_FILES

        self.assertEqual(
            DEFAULT_STRUCTURE_MODEL_FILES,
            ("config.json", "preprocessor_config.json", "processor_config.json", "model.safetensors"),
        )

    def test_structure_recognizer_uses_local_files_only_for_local_model_dir(self) -> None:
        from app.table_extract import TableTransformerRecognizer

        recognizer = TableTransformerRecognizer(
            model_id="E:/code/xafgs/ocr-table-service/model_cache/table_extract/structure",
            cache_dir="/app/model_cache/table_extract/structure",
        )
        fake_processor = mock.Mock()
        fake_model = mock.Mock()
        fake_transformers = SimpleNamespace(
            AutoImageProcessor=SimpleNamespace(from_pretrained=mock.Mock(return_value=fake_processor)),
            TableTransformerForObjectDetection=SimpleNamespace(from_pretrained=mock.Mock(return_value=fake_model)),
        )
        with mock.patch("pathlib.Path.is_dir", return_value=True):
            with mock.patch.dict("sys.modules", {"transformers": fake_transformers}):
                processor_loader = fake_transformers.AutoImageProcessor.from_pretrained
                model_loader = fake_transformers.TableTransformerForObjectDetection.from_pretrained
                recognizer._load()
        processor_loader.assert_called_once_with(
            "E:/code/xafgs/ocr-table-service/model_cache/table_extract/structure",
            cache_dir="/app/model_cache/table_extract/structure",
            local_files_only=True,
        )
        model_loader.assert_called_once_with(
            "E:/code/xafgs/ocr-table-service/model_cache/table_extract/structure",
            cache_dir="/app/model_cache/table_extract/structure",
            local_files_only=True,
        )
        fake_model.eval.assert_called_once_with()


class StructureCacheTestCase(unittest.TestCase):
    def test_normalize_default_structure_config_rewrites_null_defaults(self) -> None:
        payload = (
            '{"dilation": null, "backbone": null, "use_pretrained_backbone": true, '
            '"use_timm_backbone": false, "backbone_config": {"model_type": "resnet"}}\n'
        )
        with mock.patch("pathlib.Path.read_text", return_value=payload):
            with mock.patch("pathlib.Path.write_text") as write_text:
                changed = normalize_default_structure_config(Path("/app/model_cache/table_extract/structure"))
        self.assertTrue(changed)
        normalized_payload = write_text.call_args.args[0]
        self.assertIn('"dilation": false', normalized_payload)
        self.assertIn('"backbone": "resnet50"', normalized_payload)
        self.assertIn('"use_pretrained_backbone": false', normalized_payload)

    def test_normalize_default_structure_config_keeps_existing_values(self) -> None:
        with mock.patch(
            "pathlib.Path.read_text",
            return_value='{"dilation": false, "backbone": "resnet50", "use_pretrained_backbone": false}\n',
        ):
            with mock.patch("pathlib.Path.write_text") as write_text:
                changed = normalize_default_structure_config(Path("/app/model_cache/table_extract/structure"))
        self.assertFalse(changed)
        write_text.assert_not_called()

    def test_normalize_default_structure_config_downgrades_pretrained_backbone_when_backbone_config_exists(self) -> None:
        payload = (
            '{"dilation": false, "backbone": "resnet50", "use_pretrained_backbone": true, '
            '"use_timm_backbone": false, "backbone_config": {"model_type": "resnet"}}\n'
        )
        with mock.patch("pathlib.Path.read_text", return_value=payload):
            with mock.patch("pathlib.Path.write_text") as write_text:
                changed = normalize_default_structure_config(Path("/app/model_cache/table_extract/structure"))
        self.assertTrue(changed)
        normalized_payload = write_text.call_args.args[0]
        self.assertIn('"use_pretrained_backbone": false', normalized_payload)

    def test_normalize_default_structure_processor_configs_rewrites_legacy_size(self) -> None:
        payload = '{"image_processor_type": "DetrImageProcessor", "size": {"longest_edge": 800}}\n'
        with mock.patch("pathlib.Path.read_text", return_value=payload):
            with mock.patch("pathlib.Path.write_text") as write_text:
                changed = normalize_default_structure_processor_configs(Path("/app/model_cache/table_extract/structure"))
        self.assertTrue(changed)
        self.assertEqual(write_text.call_count, 2)
        normalized_payload = write_text.call_args.args[0]
        self.assertIn('"shortest_edge": 800', normalized_payload)
        self.assertIn('"longest_edge": 800', normalized_payload)

    def test_normalize_default_structure_processor_configs_keeps_normalized_size(self) -> None:
        payload = '{"image_processor_type": "DetrImageProcessor", "size": {"shortest_edge": 800, "longest_edge": 800}}\n'
        with mock.patch("pathlib.Path.read_text", return_value=payload):
            with mock.patch("pathlib.Path.write_text") as write_text:
                changed = normalize_default_structure_processor_configs(Path("/app/model_cache/table_extract/structure"))
        self.assertFalse(changed)
        write_text.assert_not_called()


class RequirementsTestCase(unittest.TestCase):
    def test_transformers_dependency_is_pinned(self) -> None:
        requirements = Path(__file__).resolve().parents[1] / "requirements.txt"
        content = requirements.read_text(encoding="utf-8")
        self.assertIn("transformers==4.57.5", content)


if __name__ == "__main__":
    unittest.main()
