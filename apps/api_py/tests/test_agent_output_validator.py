import os
import tempfile
import unittest

from services.agent_output_validator import validate_agent_output


class AgentOutputValidatorTests(unittest.TestCase):
    def test_rejects_stub_observer_modify(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Vendor/Module/Observer/ProductSaveAfter.php"
            full = os.path.join(cwd, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fp:
                fp.write(
                    "<?php\n"
                    "namespace Vendor\\Module\\Observer;\n"
                    "class ProductSaveAfter {\n"
                    "    public function execute($observer) {\n"
                    "        // Logic to set feed_status = DIRTY\n"
                    "    }\n"
                    "}\n"
                )

            output = {
                "files": [{
                    "path": rel,
                    "action": "modify",
                    "edits": [{
                        "oldString": "        // Logic to set feed_status = DIRTY\n",
                        "newString": (
                            "        // Logic to set feed_status = DIRTY\n\n"
                            "        // Logic to set feed_status = DIRTY\n"
                        ),
                    }],
                }],
            }
            result = validate_agent_output(cwd, output)
            self.assertTrue(result["blocking"])

    def test_accepts_real_observer_without_tests_as_warning_only(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Vendor/Module/Observer/ProductSaveAfter.php"
            full = os.path.join(cwd, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fp:
                fp.write(
                    "<?php\n"
                    "namespace Vendor\\Module\\Observer;\n"
                    "class ProductSaveAfter {\n"
                    "    public function execute($observer) {}\n"
                    "}\n"
                )

            output = {
                "files": [{
                    "path": rel,
                    "action": "create",
                    "content": (
                        "<?php\n"
                        "namespace Vendor\\Module\\Observer;\n"
                        "use Vendor\\Module\\Model\\FeedRegenerator;\n"
                        "class ProductSaveAfter {\n"
                        "    public function __construct(private FeedRegenerator $feedRegenerator) {}\n"
                        "    public function execute($observer) {\n"
                        "        $this->feedRegenerator->markDirty();\n"
                        "    }\n"
                        "}\n"
                    ),
                }],
            }
            result = validate_agent_output(cwd, output)
            self.assertEqual(result["blocking"], [])
            self.assertTrue(any("PHPUnit" in w for w in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
