"""Tests for layout head DOM auto-fix."""

import os
import tempfile
import unittest

from services.layout_head_fix_service import (
    build_layout_head_dom_auto_fix,
    layout_has_invalid_head_tags,
    magento_head_layout_errors,
)


class LayoutHeadFixServiceTests(unittest.TestCase):
    def test_detects_inline_script_in_layout(self):
        content = """<?xml version="1.0"?>
<page xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="urn:magento:framework:View/Layout/etc/page_configuration.xsd">
    <body>
        <referenceContainer name="head.additional">
            <!-- Meta Pixel Code -->
            <script>
                !function(f,b,e,v,n,t,s){if(f.fbq)return;}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
            </script>
            <noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=123&amp;ev=PageView"/></noscript>
        </referenceContainer>
    </body>
</page>
"""
        self.assertTrue(layout_has_invalid_head_tags(content))
        self.assertTrue(magento_head_layout_errors(content))

    def test_auto_fix_moves_script_to_phtml(self):
        layout_rel = (
            "app/design/frontend/Vendor/theme/Magento_Theme/layout/default_head_blocks.xml"
        )
        layout_content = """<?xml version="1.0"?>
<page xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="urn:magento:framework:View/Layout/etc/page_configuration.xsd">
    <body>
        <referenceContainer name="head.additional">
            <!-- Meta Pixel Code -->
            <script>
                !function(f,b,e,v,n,t,s){if(f.fbq)return;}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
            </script>
            <noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=123&amp;ev=PageView"/></noscript>
        </referenceContainer>
    </body>
</page>
"""
        analysis = {
            "issues": [{"kind": "layout_dom_validation"}],
            "fixTargets": [layout_rel],
        }
        with tempfile.TemporaryDirectory() as cwd:
            full = os.path.join(cwd, layout_rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fp:
                fp.write(layout_content)

            proposal = build_layout_head_dom_auto_fix(cwd, analysis)
            self.assertIsNotNone(proposal)
            paths = {f["path"] for f in proposal["files"]}
            self.assertIn(layout_rel, paths)
            self.assertTrue(any(p.endswith("meta_pixel.phtml") for p in paths))

            layout_fix = next(f for f in proposal["files"] if f["path"] == layout_rel)
            self.assertNotIn("<noscript", layout_fix["content"].lower())
            self.assertNotIn("<script>\n", layout_fix["content"].lower())
            self.assertIn("Template", layout_fix["content"])
            self.assertFalse(magento_head_layout_errors(layout_fix["content"], layout_rel))


    def test_scan_project_layout_head_errors(self):
        layout_rel = (
            "app/design/frontend/Vendor/theme/Magento_Theme/layout/default_head_blocks.xml"
        )
        layout_content = """<?xml version="1.0"?>
<page xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="urn:magento:framework:View/Layout/etc/page_configuration.xsd">
    <body>
        <referenceContainer name="head.additional">
            <script>inline();</script>
        </referenceContainer>
    </body>
</page>
"""
        with tempfile.TemporaryDirectory() as cwd:
            full = os.path.join(cwd, layout_rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fp:
                fp.write(layout_content)

            from services.layout_head_fix_service import scan_project_layout_head_errors

            findings = scan_project_layout_head_errors(
                cwd,
                active_theme="Vendor/theme",
                seed_paths=[layout_rel],
            )
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0]["path"], layout_rel)

    def test_build_deploy_fix_default_instructions_includes_scan(self):
        from services.deploy_error_service import build_deploy_fix_default_instructions

        analysis = {
            "summary": "Invalid theme layout/head XML (storefront check)",
            "failedStep": "storefront_probe",
            "layoutDomError": True,
            "fixTargets": ["app/design/frontend/Vendor/theme/Magento_Theme/layout/default_head_blocks.xml"],
            "layoutScanFindings": [{
                "path": "app/design/frontend/Vendor/theme/Magento_Theme/layout/default_head_blocks.xml",
                "errors": ["inline script not allowed"],
            }],
            "issues": [{
                "kind": "layout_dom_validation",
                "message": "Storefront layout/head XML validation failed",
            }],
            "rawOutput": "Element 'script': The attribute 'src' is required but missing.",
        }
        text = build_deploy_fix_default_instructions(analysis)
        self.assertIn("default_head_blocks.xml", text)
        self.assertIn("Magento-standard fix", text)
        self.assertIn("Element 'script'", text)


if __name__ == "__main__":
    unittest.main()
