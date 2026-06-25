import unittest

from services.php_lint import lint_php_content, resolve_php_lint_bin


class PhpLintTests(unittest.TestCase):
    def test_resolve_php_lint_bin_falls_back_to_php(self):
        self.assertTrue(resolve_php_lint_bin("definitely-not-a-real-binary-xyz"))

    def test_lint_valid_php(self):
        self.assertIsNone(lint_php_content(resolve_php_lint_bin(None), "<?php\nclass A {}\n"))

    def test_lint_invalid_php(self):
        err = lint_php_content(resolve_php_lint_bin(None), "<?php\nclass A {\n}\n}\n")
        self.assertIsNotNone(err)


if __name__ == "__main__":
    unittest.main()
