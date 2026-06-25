import os
import tempfile
import unittest

from services.git_service import merge_refined_files, normalize_file_changes


class GitServiceNormalizeTests(unittest.TestCase):
    def test_modify_on_missing_file_becomes_create_with_content(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Vendor/Module/Test/Unit/Model/FooTest.php"
            files = normalize_file_changes(cwd, [{
                "path": rel,
                "action": "modify",
                "content": "<?php\nclass FooTest {}\n",
                "edits": [{"oldString": "x", "newString": "y"}],
            }])
            self.assertEqual(files[0]["action"], "create")
            self.assertIsNone(files[0]["edits"])
            self.assertIn("FooTest", files[0]["content"])

    def test_modify_on_missing_file_with_empty_old_edit_becomes_create(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Vendor/Module/Test/Unit/Model/BarTest.php"
            body = "<?php\nclass BarTest {}\n"
            files = normalize_file_changes(cwd, [{
                "path": rel,
                "action": "modify",
                "edits": [{"oldString": "", "newString": body}],
            }])
            self.assertEqual(files[0]["action"], "create")
            self.assertEqual(files[0]["content"], body)

    def test_merge_refined_files_keeps_prior_when_partial(self):
        prior = [
            {"path": "a.php", "action": "create", "content": "a"},
            {"path": "b.php", "action": "create", "content": "b"},
            {"path": "c.php", "action": "create", "content": "c"},
        ]
        new = [{"path": "a.php", "action": "create", "content": "a2"}]
        merged = merge_refined_files(prior, new)
        paths = {f["path"] for f in merged}
        self.assertEqual(paths, {"a.php", "b.php", "c.php"})
        by_path = {f["path"]: f for f in merged}
        self.assertEqual(by_path["a.php"]["content"], "a2")
        self.assertEqual(by_path["b.php"]["content"], "b")


if __name__ == "__main__":
    unittest.main()
