import unittest
from pathlib import Path
from unittest import mock

from app.table_extract import (
    DEFAULT_LAYOUT_MODEL,
    DEFAULT_LAYOUT_MODEL_FILE,
    DetectionBox,
    RectifyDetection,
    TableExtractError,
    TableImageVariant,
    build_table_cells,
    build_table_result,
    build_table_image_variants,
    ensure_layout_model_source,
    recognize_best_table_variant,
)
from app.table_extract_shared import BorderTrimOptions
from app.table_rectify import rectify_table_crop, trim_table_border
from PIL import Image
from app.table_extract import extract_tables


class TableExtractGeometryTestCase(unittest.TestCase):
    def test_default_layout_model_prefers_local_cache_file(self) -> None:
        cache_root = "/tmp/table_extract"
        expected_model_path = str(Path(cache_root) / "layout" / DEFAULT_LAYOUT_MODEL_FILE)
        with mock.patch("app.table_extract_shared.resolve_layout_cache_dir", return_value=f"{cache_root}/layout"):
            with mock.patch("pathlib.Path.is_file", return_value=True):
                self.assertEqual(ensure_layout_model_source(DEFAULT_LAYOUT_MODEL), expected_model_path)

    def test_default_layout_model_requires_prewarm_when_cache_missing(self) -> None:
        with mock.patch("app.table_extract_shared.resolve_layout_cache_dir", return_value="/tmp/table_extract/layout"):
            with mock.patch("pathlib.Path.is_file", return_value=False):
                with self.assertRaises(TableExtractError) as ctx:
                    ensure_layout_model_source(DEFAULT_LAYOUT_MODEL)
        self.assertIn("DocLayout-YOLO layout 模型未预热", str(ctx.exception))

    def test_build_table_cells_respects_spanning_and_headers(self) -> None:
        rows = [
            DetectionBox(label="table row", score=0.99, bbox=[0, 0, 180, 40]),
            DetectionBox(label="table row", score=0.98, bbox=[0, 40, 180, 80]),
        ]
        columns = [
            DetectionBox(label="table column", score=0.99, bbox=[0, 0, 60, 80]),
            DetectionBox(label="table column", score=0.99, bbox=[60, 0, 120, 80]),
            DetectionBox(label="table column", score=0.99, bbox=[120, 0, 180, 80]),
        ]
        headers = [DetectionBox(label="table column header", score=0.97, bbox=[0, 0, 180, 40])]
        projected_headers = [DetectionBox(label="table projected row header", score=0.96, bbox=[0, 0, 60, 80])]
        spanning = [DetectionBox(label="table spanning cell", score=0.95, bbox=[0, 0, 120, 40])]

        cells = build_table_cells(
            rows,
            columns,
            headers,
            projected_headers,
            spanning,
            crop_size=(180, 80),
            crop_offset=[20, 30],
            inverse_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            rectified_crop_offset=[0.0, 0.0],
        )

        self.assertEqual(len(cells), 5)
        merged = cells[0]
        self.assertEqual(merged["rowIndex"], 0)
        self.assertEqual(merged["colIndex"], 0)
        self.assertEqual(merged["colSpan"], 2)
        self.assertTrue(merged["isColumnHeader"])
        self.assertTrue(merged["isProjectedRowHeader"])
        self.assertEqual(merged["pageBBox"], [20.0, 30.0, 140.0, 70.0])

        trailing = next(cell for cell in cells if cell["rowIndex"] == 0 and cell["colIndex"] == 2)
        self.assertTrue(trailing["isColumnHeader"])
        self.assertFalse(trailing["isProjectedRowHeader"])

    def test_build_table_result_preserves_page_and_crop_coordinates(self) -> None:
        image = Image.new("RGB", (400, 240), "white")
        detection = DetectionBox(label="table", score=0.91, bbox=[50, 60, 250, 180])
        structure_items = [
            DetectionBox(label="table row", score=0.99, bbox=[0, 0, 220, 70]),
            DetectionBox(label="table row", score=0.99, bbox=[0, 70, 220, 140]),
            DetectionBox(label="table column", score=0.99, bbox=[0, 0, 110, 140]),
            DetectionBox(label="table column", score=0.99, bbox=[110, 0, 220, 140]),
        ]
        table_variant = TableImageVariant(
            image=Image.new("RGB", (220, 140), "white"),
            candidate_roi_bbox=[40, 50, 260, 190],
            final_crop_bbox=[0.0, 0.0, 220.0, 140.0],
            roi_quad=None,
            forward_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            inverse_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            rectified=False,
            rectify_mode="fallback_none",
            rotation_applied=0,
            original_crop_width=220,
            original_crop_height=140,
            deskew_angle=0.0,
            quad_score=0.0,
            line_coverage_horizontal=0.01,
            line_coverage_vertical=0.01,
            rectify_scale=1.5,
            rectify_interpolation="lanczos4",
            rectified_width=220,
            rectified_height=140,
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=3,
            border_trim_min_projection_ratio=0.1,
        )

        table = build_table_result(
            image,
            page_no=2,
            table_no=1,
            detection=detection,
            structure_items=structure_items,
            table_variant=table_variant,
        )

        self.assertEqual(table["pageNo"], 2)
        self.assertEqual(table["tableType"], "wired")
        self.assertEqual(table["rowCount"], 2)
        self.assertEqual(table["colCount"], 2)
        self.assertEqual(len(table["cells"]), 4)
        first = table["cells"][0]
        self.assertEqual(first["cropPolygon"][0], [first["cropBBox"][0], first["cropBBox"][1]])
        self.assertEqual(first["pageBBox"], [40.0, 50.0, 150.0, 120.0])
        self.assertEqual(table["cropBBox"], [0.0, 0.0, 220.0, 140.0])
        self.assertEqual(table["meta"]["rectifyMode"], "fallback_none")
        self.assertEqual(table["meta"]["rectifiedWidth"], 220)
        self.assertEqual(table["meta"]["rectifiedHeight"], 140)
        self.assertFalse(table["meta"]["borderTrimApplied"])

    def test_build_table_result_maps_page_polygon_via_inverse_matrix(self) -> None:
        image = Image.new("RGB", (300, 200), "white")
        detection = DetectionBox(label="table", score=0.91, bbox=[40, 20, 180, 120])
        structure_items = [
            DetectionBox(label="table row", score=0.99, bbox=[0, 0, 100, 50]),
            DetectionBox(label="table column", score=0.99, bbox=[0, 0, 50, 50]),
        ]
        table_variant = TableImageVariant(
            image=Image.new("RGB", (100, 50), "white"),
            candidate_roi_bbox=[10, 15, 110, 65],
            final_crop_bbox=[0.0, 0.0, 100.0, 50.0],
            roi_quad=None,
            forward_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            inverse_matrix=[[1.0, 0.0, 5.0], [0.0, 1.0, 7.0], [0.0, 0.0, 1.0]],
            rectified=True,
            rectify_mode="line_quad",
            rotation_applied=0,
            original_crop_width=120,
            original_crop_height=60,
            deskew_angle=1.2,
            quad_score=0.66,
            line_coverage_horizontal=0.15,
            line_coverage_vertical=0.12,
            rectify_scale=1.5,
            rectify_interpolation="lanczos4",
            rectified_width=150,
            rectified_height=75,
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=3,
            border_trim_min_projection_ratio=0.1,
        )

        table = build_table_result(image, 1, 1, detection, structure_items, table_variant)

        first = table["cells"][0]
        self.assertEqual(first["pageBBox"], [15.0, 22.0, 65.0, 72.0])
        self.assertTrue(table["meta"]["rectified"])
        self.assertEqual(table["meta"]["rectifyMode"], "line_quad")
        self.assertEqual(table["meta"]["originalCropWidth"], 120)
        self.assertEqual(table["meta"]["rectifyScale"], 1.5)
        self.assertEqual(table["meta"]["rectifyInterpolation"], "lanczos4")

    def test_build_table_result_maps_page_polygon_with_trim_offset(self) -> None:
        image = Image.new("RGB", (300, 200), "white")
        detection = DetectionBox(label="table", score=0.91, bbox=[40, 20, 180, 120])
        structure_items = [
            DetectionBox(label="table row", score=0.99, bbox=[0, 0, 50, 30]),
            DetectionBox(label="table column", score=0.99, bbox=[0, 0, 40, 30]),
        ]
        table_variant = TableImageVariant(
            image=Image.new("RGB", (40, 30), "white"),
            candidate_roi_bbox=[10, 15, 110, 65],
            final_crop_bbox=[0.0, 0.0, 40.0, 30.0],
            roi_quad=None,
            forward_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            inverse_matrix=[[1.0, 0.0, 5.0], [0.0, 1.0, 7.0], [0.0, 0.0, 1.0]],
            rectified=True,
            rectify_mode="line_quad",
            rotation_applied=0,
            original_crop_width=120,
            original_crop_height=60,
            deskew_angle=1.2,
            quad_score=0.66,
            line_coverage_horizontal=0.15,
            line_coverage_vertical=0.12,
            rectify_scale=1.5,
            rectify_interpolation="lanczos4",
            rectified_width=100,
            rectified_height=60,
            rectified_crop_offset=[20.0, 10.0],
            border_trim_applied=True,
            border_trim_bbox=[20.0, 10.0, 60.0, 40.0],
            border_trim_margin_px=3,
            border_trim_min_projection_ratio=0.1,
        )
        table = build_table_result(image, 1, 1, detection, structure_items, table_variant)
        first = table["cells"][0]
        self.assertEqual(first["pageBBox"], [35.0, 32.0, 75.0, 62.0])
        self.assertTrue(table["meta"]["borderTrimApplied"])
        self.assertEqual(table["meta"]["borderTrimBBox"], [20.0, 10.0, 60.0, 40.0])

    def test_build_table_image_variants_rotates_after_rectify(self) -> None:
        base_variant = TableImageVariant(
            image=Image.new("RGB", (100, 180), "white"),
            candidate_roi_bbox=[0, 0, 100, 180],
            final_crop_bbox=[0.0, 0.0, 100.0, 180.0],
            roi_quad=None,
            forward_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            inverse_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            rectified=True,
            rectify_mode="line_quad",
            rotation_applied=0,
            original_crop_width=100,
            original_crop_height=180,
            deskew_angle=0.8,
            quad_score=0.75,
            line_coverage_horizontal=0.2,
            line_coverage_vertical=0.2,
            rectify_scale=1.5,
            rectify_interpolation="lanczos4",
            rectified_width=100,
            rectified_height=180,
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=3,
            border_trim_min_projection_ratio=0.1,
        )
        with mock.patch("app.table_rectify.rectify_table_crop", return_value=base_variant):
            variants = build_table_image_variants(Image.new("RGB", (100, 180), "white"), [0, 0, 100, 180])
        self.assertEqual(len(variants), 2)
        self.assertEqual(variants[0].rectify_mode, "line_quad")
        self.assertEqual(variants[1].rotation_applied, 90)
        self.assertEqual(variants[1].rectified_width, 180)
        self.assertEqual(variants[1].rectified_height, 100)

    def test_recognize_best_table_variant_prefers_higher_structure_score(self) -> None:
        wide = TableImageVariant(
            image=Image.new("RGB", (180, 100), "white"),
            candidate_roi_bbox=[0, 0, 180, 100],
            final_crop_bbox=[0.0, 0.0, 180.0, 100.0],
            roi_quad=None,
            forward_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            inverse_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            rectified=False,
            rectify_mode="fallback_none",
            rotation_applied=0,
            original_crop_width=180,
            original_crop_height=100,
            deskew_angle=0.0,
            quad_score=0.0,
            line_coverage_horizontal=0.0,
            line_coverage_vertical=0.0,
            rectify_scale=1.5,
            rectify_interpolation="lanczos4",
            rectified_width=180,
            rectified_height=100,
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=3,
            border_trim_min_projection_ratio=0.1,
        )
        tall = TableImageVariant(
            image=Image.new("RGB", (100, 180), "white"),
            candidate_roi_bbox=[0, 0, 100, 180],
            final_crop_bbox=[0.0, 0.0, 100.0, 180.0],
            roi_quad=None,
            forward_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            inverse_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            rectified=False,
            rectify_mode="deskew_only",
            rotation_applied=90,
            original_crop_width=100,
            original_crop_height=180,
            deskew_angle=0.0,
            quad_score=0.0,
            line_coverage_horizontal=0.0,
            line_coverage_vertical=0.0,
            rectify_scale=1.5,
            rectify_interpolation="lanczos4",
            rectified_width=100,
            rectified_height=180,
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=3,
            border_trim_min_projection_ratio=0.1,
        )
        recognizer = mock.Mock()
        recognizer.recognize.side_effect = [
            [DetectionBox(label="table row", score=0.9, bbox=[0, 0, 180, 50])],
            [
                DetectionBox(label="table row", score=0.9, bbox=[0, 0, 100, 90]),
                DetectionBox(label="table row", score=0.9, bbox=[0, 90, 100, 180]),
                DetectionBox(label="table column", score=0.9, bbox=[0, 0, 50, 180]),
                DetectionBox(label="table column", score=0.9, bbox=[50, 0, 100, 180]),
            ],
        ]
        best_variant, items = recognize_best_table_variant(recognizer, [wide, tall], 0.35)
        self.assertIs(best_variant, tall)
        self.assertEqual(len(items), 4)

    def test_rectify_table_crop_line_quad_reports_scaled_rectified_meta(self) -> None:
        image = Image.new("RGB", (200, 120), "white")
        detection = RectifyDetection(
            rectify_mode="line_quad",
            quad=[[10.0, 10.0], [170.0, 10.0], [170.0, 90.0], [10.0, 90.0]],
            deskew_angle=0.4,
            quad_score=0.81,
            line_coverage_horizontal=0.14,
            line_coverage_vertical=0.16,
        )
        with mock.patch("app.table_rectify.detect_table_quad", return_value=detection):
            variant = rectify_table_crop(image, [0, 0, 200, 120])
        self.assertEqual(variant.rectify_mode, "line_quad")
        self.assertGreater(variant.rectified_width, 160)
        self.assertGreater(variant.rectified_height, 80)
        self.assertEqual(variant.rectify_scale, 1.5)
        self.assertEqual(variant.rectify_interpolation, "lanczos4")

    def test_rectify_table_crop_deskew_only_reports_rectify_meta(self) -> None:
        image = Image.new("RGB", (200, 120), "white")
        detection = RectifyDetection(
            rectify_mode="deskew_only",
            quad=None,
            deskew_angle=1.5,
            quad_score=0.2,
            line_coverage_horizontal=0.08,
            line_coverage_vertical=0.09,
        )
        with mock.patch("app.table_rectify.detect_table_quad", return_value=detection):
            variant = rectify_table_crop(image, [0, 0, 200, 120])
        self.assertEqual(variant.rectify_mode, "deskew_only")
        self.assertEqual(variant.rectified_width, 200)
        self.assertEqual(variant.rectified_height, 120)
        self.assertEqual(variant.rectify_scale, 1.5)
        self.assertEqual(variant.rectify_interpolation, "lanczos4")

    def test_rectify_table_crop_honors_rectify_scale_env(self) -> None:
        image = Image.new("RGB", (200, 120), "white")
        detection = RectifyDetection(
            rectify_mode="line_quad",
            quad=[[0.0, 0.0], [100.0, 0.0], [100.0, 60.0], [0.0, 60.0]],
            deskew_angle=0.0,
            quad_score=0.91,
            line_coverage_horizontal=0.2,
            line_coverage_vertical=0.2,
        )
        with mock.patch("app.table_rectify.detect_table_quad", return_value=detection):
            baseline = rectify_table_crop(image, [0, 0, 200, 120])
        with mock.patch.dict("os.environ", {"TABLE_EXTRACT_RECTIFY_SCALE": "2.0"}, clear=False):
            with mock.patch("app.table_rectify.detect_table_quad", return_value=detection):
                scaled = rectify_table_crop(image, [0, 0, 200, 120])
        self.assertGreater(scaled.rectified_width, baseline.rectified_width)
        self.assertGreater(scaled.rectified_height, baseline.rectified_height)
        self.assertEqual(scaled.rectify_scale, 2.0)

    def test_rectify_table_crop_honors_rectify_max_edge_env(self) -> None:
        image = Image.new("RGB", (200, 120), "white")
        detection = RectifyDetection(
            rectify_mode="line_quad",
            quad=[[0.0, 0.0], [300.0, 0.0], [300.0, 100.0], [0.0, 100.0]],
            deskew_angle=0.0,
            quad_score=0.91,
            line_coverage_horizontal=0.2,
            line_coverage_vertical=0.2,
        )
        with mock.patch.dict("os.environ", {"TABLE_EXTRACT_RECTIFY_SCALE": "2.0", "TABLE_EXTRACT_RECTIFY_MAX_EDGE": "256"}, clear=False):
            with mock.patch("app.table_rectify.detect_table_quad", return_value=detection):
                variant = rectify_table_crop(image, [0, 0, 200, 120])
        self.assertLessEqual(max(variant.rectified_width, variant.rectified_height), 256)

    def test_trim_table_border_returns_tight_bbox(self) -> None:
        image = Image.new("RGB", (120, 80), "white")
        options = BorderTrimOptions(True, 0.1, 3, 0.65, 0.2)
        with mock.patch("app.table_rectify.build_table_line_masks", return_value=("h", "v")):
            with mock.patch("app.table_rectify.estimate_line_coverage", side_effect=[0.2, 0.2]):
                with mock.patch("app.table_rectify.find_projection_bounds", side_effect=[(10, 69), (12, 99)]):
                    trimmed_image, trim_bbox, applied = trim_table_border(image, options)
        self.assertTrue(applied)
        self.assertEqual(trim_bbox, [9.0, 7.0, 103.0, 73.0])
        self.assertEqual(trimmed_image.size, (94, 66))

    def test_rectify_table_crop_applies_border_trim_and_offset(self) -> None:
        image = Image.new("RGB", (200, 120), "white")
        detection = RectifyDetection(
            rectify_mode="line_quad",
            quad=[[0.0, 0.0], [100.0, 0.0], [100.0, 60.0], [0.0, 60.0]],
            deskew_angle=0.0,
            quad_score=0.91,
            line_coverage_horizontal=0.2,
            line_coverage_vertical=0.2,
        )
        options = BorderTrimOptions(True, 0.1, 3, 0.65, 0.2)
        with mock.patch("app.table_rectify.detect_table_quad", return_value=detection):
            with mock.patch("app.table_rectify.trim_table_border", return_value=(Image.new("RGB", (90, 50), "white"), [5.0, 4.0, 95.0, 54.0], True)):
                variant = rectify_table_crop(image, [0, 0, 200, 120], options)
        self.assertTrue(variant.border_trim_applied)
        self.assertEqual(variant.border_trim_bbox, [5.0, 4.0, 95.0, 54.0])
        self.assertEqual(variant.rectified_crop_offset, [5.0, 4.0])
        self.assertEqual(variant.image.size, (90, 50))


class TableExtractParamsTestCase(unittest.TestCase):
    def test_extract_tables_uses_new_param_defaults(self) -> None:
        page = mock.Mock()
        page.page_no = 1
        page.source = "image"
        page.image = Image.new("RGB", (200, 120), "white")
        detection = DetectionBox(label="table", score=0.9, bbox=[10, 10, 100, 80])
        variant = TableImageVariant(
            image=Image.new("RGB", (100, 60), "white"),
            candidate_roi_bbox=[10, 10, 110, 70],
            final_crop_bbox=[0.0, 0.0, 100.0, 60.0],
            roi_quad=None,
            forward_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            inverse_matrix=[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            rectified=False,
            rectify_mode="fallback_none",
            rotation_applied=0,
            original_crop_width=100,
            original_crop_height=60,
            deskew_angle=0.0,
            quad_score=0.0,
            line_coverage_horizontal=0.1,
            line_coverage_vertical=0.1,
            rectify_scale=1.5,
            rectify_interpolation="lanczos4",
            rectified_width=100,
            rectified_height=60,
            rectified_crop_offset=[0.0, 0.0],
            border_trim_applied=False,
            border_trim_bbox=None,
            border_trim_margin_px=3,
            border_trim_min_projection_ratio=0.1,
        )
        with mock.patch("app.table_extract.load_pages", return_value=[page]):
            with mock.patch("app.table_extract.get_layout_detector") as detector_loader:
                with mock.patch("app.table_extract.get_structure_recognizer", return_value=mock.Mock()):
                    with mock.patch("app.table_extract.build_table_image_variants", return_value=[variant]):
                        with mock.patch("app.table_extract.recognize_best_table_variant", return_value=(variant, [])):
                            with mock.patch("app.table_extract.rectify_table_crop", return_value=variant):
                                with mock.patch("app.table_extract.build_table_result", return_value={"meta": {}}):
                                    detector_loader.return_value.detect.return_value = [detection]
                                    result = extract_tables({"file": "ZmFrZQ=="})
        self.assertEqual(result["detection_threshold"], 0.85)
        self.assertEqual(result["structure_threshold"], 0.6)
        self.assertEqual(result["tableCount"], 1)

    def test_extract_tables_rejects_invalid_threshold_range(self) -> None:
        with self.assertRaises(TableExtractError):
            extract_tables({"file": "ZmFrZQ==", "detection_threshold": 1.2})


if __name__ == "__main__":
    unittest.main()
