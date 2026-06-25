from services.test_error_service import (
    analyze_test_failure,
    build_phpunit_auto_fix,
    infer_class_under_test,
)


def test_infer_class_under_test():
    rel = "app/code/Vendor/Module/Test/Unit/Model/FooTest.php"
    assert infer_class_under_test(rel) == "app/code/Vendor/Module/Model/Foo.php"


def test_analyze_test_failure_extracts_test_file():
    report = {
        "steps": [{
            "key": "phpunit_x",
            "label": "PHPUnit (app/code/Vendor/Module/Test/Unit/Model/FooTest.php)",
            "ok": False,
            "skipped": False,
            "output": "PHP Fatal error: abstract methods",
        }],
    }
    analysis = analyze_test_failure(report)
    assert "app/code/Vendor/Module/Test/Unit/Model/FooTest.php" in analysis["errorFiles"]
    assert analysis["aiFixable"] is True


def test_build_phpunit_auto_fix_replaces_anonymous_product_interface(tmp_path):
    module = tmp_path / "app/code/Vendor/Module/Test/Unit/Model"
    module.mkdir(parents=True)
    test_file = module / "FooTest.php"
    test_file.write_text(
        """<?php
use Magento\\Catalog\\Api\\Data\\ProductInterface;
class FooTest extends \\PHPUnit\\Framework\\TestCase {
    private function createMockProduct(): ProductInterface {
        return new class implements ProductInterface {
            public function getId() { return 1; }
        };
    }
}
""",
        encoding="utf-8",
    )
    analysis = {
        "rawOutput": "PHP Fatal error: abstract methods ProductInterface@anonymous",
        "errorFiles": ["app/code/Vendor/Module/Test/Unit/Model/FooTest.php"],
    }
    result = build_phpunit_auto_fix(str(tmp_path), analysis)
    assert result is not None
    fixed = result["files"][0]["content"]
    assert "createMock(ProductInterface::class)" in fixed
    assert "new class implements" not in fixed
