import os
import tempfile
import unittest

from services.git_service import (
    merge_refined_files,
    normalize_agent_path,
    normalize_file_changes,
    repair_file_changes,
)


class GitServiceNormalizeTests(unittest.TestCase):
    def test_normalize_agent_path_maps_docker_root(self):
        cwd = "/var/www/html/fabric5anddime_m2"
        raw = "/var/www/html/app/code/Vendor/Module/Plugin/Foo.php"
        self.assertEqual(
            normalize_agent_path(cwd, raw),
            "app/code/Vendor/Module/Plugin/Foo.php",
        )

    def test_normalize_file_changes_accepts_docker_absolute_path(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Vendor/Module/Test/Unit/Model/FooTest.php"
            files = normalize_file_changes(cwd, [{
                "path": f"/var/www/html/{rel}",
                "action": "modify",
                "content": "<?php\nclass FooTest {}\n",
            }])
            self.assertEqual(files[0]["path"], rel)
            self.assertEqual(files[0]["action"], "create")

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

    def test_modify_on_missing_file_with_full_php_in_edit_becomes_create(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/Api/DisplayProducts.php"
            body = (
                "<?php\n"
                "namespace Commercepundit\\BocaBargoons\\Api;\n"
                "interface DisplayProducts\n"
                "{\n"
                "    public function getList();\n"
                "}\n"
            )
            files = repair_file_changes(cwd, [{
                "path": rel,
                "action": "modify",
                "edits": [{
                    "oldString": "    public function getList() {}",
                    "newString": body,
                }],
            }])
            self.assertEqual(files[0]["action"], "create")
            self.assertIn("interface DisplayProducts", files[0]["content"])

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

    def test_merge_refined_files_skips_broken_prior(self):
        prior = [
            {"path": "a.php", "action": "create", "content": "// stub"},
            {"path": "b.php", "action": "create", "content": "good"},
            {"path": "c.php", "action": "create", "content": "// stub"},
        ]
        new = [{"path": "a.php", "action": "create", "content": "fixed a"}]
        merged = merge_refined_files(prior, new, broken_paths={"a.php", "c.php"})
        paths = {f["path"] for f in merged}
        self.assertEqual(paths, {"a.php", "b.php"})
        by_path = {f["path"]: f for f in merged}
        self.assertEqual(by_path["a.php"]["content"], "fixed a")
        self.assertEqual(by_path["b.php"]["content"], "good")


if __name__ == "__main__":
    unittest.main()
