import unittest

from app.markdown_utils import clean_markdown_ocr_output


class MarkdownCleaningTestCase(unittest.TestCase):
    def test_strip_markdown_fence(self) -> None:
        self.assertEqual(clean_markdown_ocr_output("```markdown\nAF\n```"), "AF")

    def test_strip_md_fence(self) -> None:
        self.assertEqual(clean_markdown_ocr_output("```md\n# 标题\n```"), "# 标题")

    def test_keep_plain_html_table(self) -> None:
        value = "<table><tr><td>A</td></tr></table>"
        self.assertEqual(clean_markdown_ocr_output(value), value)


if __name__ == "__main__":
    unittest.main()
