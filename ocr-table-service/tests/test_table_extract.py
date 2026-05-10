import unittest
from pathlib import Path
from unittest import mock

from app.table_extract import (
    DEFAULT_LAYOUT_MODEL,
    DEFAULT_LAYOUT_MODEL_FILE,
    DetectionBox,
    TableExtractError,
    TableImageVariant,
    build_table_cells,
    build_table_result,
    build_table_image_variants,
    ensure_layout_model_source,
    recognize_best_table_variant,
)
from PIL import Image


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
        )

        table = build_table_result(image, 1, 1, detection, structure_items, table_variant)

        first = table["cells"][0]
        self.assertEqual(first["pageBBox"], [15.0, 22.0, 65.0, 72.0])
        self.assertTrue(table["meta"]["rectified"])
        self.assertEqual(table["meta"]["rectifyMode"], "line_quad")
        self.assertEqual(table["meta"]["originalCropWidth"], 120)

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
        )
        with mock.patch("app.table_rectify.rectify_table_crop", return_value=base_variant):
            variants = build_table_image_variants(Image.new("RGB", (100, 180), "white"), [0, 0, 100, 180])
        self.assertEqual(len(variants), 2)
        self.assertEqual(variants[0].rectify_mode, "line_quad")
        self.assertEqual(variants[1].rotation_applied, 90)

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


if __name__ == "__main__":
    unittest.main()
