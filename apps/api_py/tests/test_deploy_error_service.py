import os
import tempfile
import unittest

from services.deploy_error_service import (
    analyze_deploy_failure,
    apply_auto_fixes,
    build_auto_fix_proposals,
    build_php_syntax_auto_fix,
    enrich_deploy_fix_analysis,
    enrich_deploy_report,
    gather_deploy_fix_excerpts,
    merge_deploy_analysis,
    deploy_fix_target_paths,
    _fix_db_schema_content,
    _fix_webapi_content,
)


AUTO_INCREMENT_OUTPUT = """
Schema creation/updates:
The XML in file "/var/www/html/app/code/Commercepundit/BocaBargoons/etc/db_schema.xml" is invalid:

Element 'column', attribute 'auto_increment': The attribute 'auto_increment' is not allowed.
Line: 4

Verify the XML and try again.
"""

CONSTRAINT_COLUMNS_OUTPUT = """
Schema creation/updates:
The XML in file "/var/www/html/app/code/Commercepundit/BocaBargoons/etc/db_schema.xml" is invalid:

Element 'constraint', attribute 'columns': The attribute 'columns' is not allowed.
Line: 11

Element 'constraint', attribute 'columns': The attribute 'columns' is not allowed.
Line: 21

Verify the XML and try again.
"""

COLUMN_PRIMARY_OUTPUT = """
Schema creation/updates:
The XML in file "/var/www/html/app/code/Commercepundit/BocaBargoons/etc/db_schema.xml" is invalid:

Element 'column', attribute 'primary': The attribute 'primary' is not allowed.
Line: 4

Element 'column', attribute 'primary': The attribute 'primary' is not allowed.
Line: 16

Verify the XML and try again.
"""

MALFORMED_DB_SCHEMA_OUTPUT = """
Schema creation/updates:
The XML in file "/var/www/html/app/code/Commercepundit/BocaBargoons/etc/db_schema.xml" is invalid:

Verify the XML and try again.
"""

WEBAPI_XML_OUTPUT = """
Schema creation/updates:
The XML in file "/var/www/html/app/code/Commercepundit/BocaBargoons/etc/webapi.xml" is invalid:
Element '{urn:magento:framework:Webapi/etc/webapi.xsd}config': No matching global declaration available for the validation root.
Line: 2

Verify the XML and try again.
"""

WEBAPI_ROUTES_WRONG_SCHEMA_OUTPUT = """
Schema creation/updates:
The XML in file "/var/www/html/app/code/Commercepundit/BocaBargoons/etc/webapi.xml" is invalid:
Element '{urn:magento:framework:Webapi/etc/webapi.xsd}routes': No matching global declaration available for the validation root.
Line: 2

Verify the XML and try again.
"""

BROKEN_WEBAPI = (
    '<?xml version="1.0"?>\n'
    '<config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    'xsi:noNamespaceSchemaLocation="urn:magento:framework:Webapi/etc/webapi.xsd">\n'
    '</config>\n'
)

BROKEN_WEBAPI_ROUTES_WRONG_SCHEMA = (
    '<?xml version="1.0"?>\n'
    '<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    'xsi:noNamespaceSchemaLocation="urn:magento:framework:Webapi/etc/webapi.xsd">\n'
    '</routes>\n'
)

WEBAPI_CORRECT_SCHEMA = "urn:magento:module:Magento_Webapi:etc/webapi.xsd"

WEBAPI_MISSING_RESOURCES_OUTPUT = """
Element 'route': Missing child element(s). Expected is ( resources ).
Line: 3

Element 'route': Missing child element(s). Expected is ( resources ).
Line: 7

Element 'route': Missing child element(s). Expected is ( resources ).
Line: 10

Verify the XML and try again.
"""

BROKEN_WEBAPI_MISSING_RESOURCES = (
    '<?xml version="1.0"?>\n'
    f'<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    f'xsi:noNamespaceSchemaLocation="{WEBAPI_CORRECT_SCHEMA}">\n'
    '    <route url="/V1/bocabargoons/feed" method="GET">\n'
    '        <service class="Commercepundit\\BocaBargoons\\Api\\FeedInterface" method="getFeed"/>\n'
    '    </route>\n'
    '    <route url="/V1/bocabargoons/feed/:id" method="GET">\n'
    '        <service class="Commercepundit\\BocaBargoons\\Api\\FeedInterface" method="getById"/>\n'
    '    </route>\n'
    '    <route url="/V1/bocabargoons/feed" method="POST">\n'
    '        <service class="Commercepundit\\BocaBargoons\\Api\\FeedInterface" method="save"/>\n'
    '    </route>\n'
    '</routes>\n'
)


class DeployErrorServiceTests(unittest.TestCase):
    def _write_schema(self, cwd: str, rel: str, content: str) -> None:
        full = os.path.join(cwd, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fp:
            fp.write(content)

    def test_analyze_db_schema_auto_increment(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/db_schema.xml"
            self._write_schema(cwd, rel, '<column auto_increment="true" />\n')

            deploy = {
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": AUTO_INCREMENT_OUTPUT},
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            self.assertTrue(analysis["autoFixable"])
            self.assertEqual(analysis["issues"][0]["kind"], "db_schema_column_auto_increment")
            self.assertEqual(analysis["failedStep"], "setup_upgrade")

    def test_analyze_constraint_columns_not_composer_false_positive(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/db_schema.xml"
            self._write_schema(
                cwd,
                rel,
                '<constraint xsi:type="primary" referenceId="PRIMARY" columns="entity_id" />\n',
            )

            deploy = {
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": CONSTRAINT_COLUMNS_OUTPUT},
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            self.assertTrue(analysis["autoFixable"])
            self.assertEqual(analysis["issues"][0]["kind"], "db_schema_constraint_columns")
            self.assertNotIn("composer", analysis["summary"].lower())
            self.assertEqual(analysis["failedStep"], "setup_upgrade")

    def test_fix_db_schema_content_all_issues(self):
        original = (
            '<?xml version="1.0"?>\n'
            '<schema>\n'
            '  <table>\n'
            '    <column name="entity_id" auto_increment="true" />\n'
            '    <constraint xsi:type="primary" referenceId="PRIMARY" columns="entity_id" />\n'
            '  </table>\n'
            '</schema>\n'
        )
        updated, summaries = _fix_db_schema_content(original)
        self.assertIn('identity="true"', updated)
        self.assertNotIn("auto_increment", updated)
        self.assertIn('<column name="entity_id" />', updated)
        self.assertNotIn('columns="entity_id"', updated)
        self.assertEqual(len(summaries), 2)

    def test_analyze_column_primary_attribute(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/db_schema.xml"
            self._write_schema(
                cwd,
                rel,
                (
                    '<?xml version="1.0"?>\n'
                    '<schema>\n'
                    '  <table name="cp_feed" resource="default" engine="innodb">\n'
                    '    <column name="entity_id" xsi:type="int" identity="true" primary="true"/>\n'
                    '  </table>\n'
                    '</schema>\n'
                ),
            )

            deploy = {
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": COLUMN_PRIMARY_OUTPUT},
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            self.assertTrue(analysis["autoFixable"])
            self.assertEqual(analysis["issues"][0]["kind"], "db_schema_column_primary")
            self.assertEqual(analysis["failedStep"], "setup_upgrade")

    def test_fix_db_schema_content_column_primary(self):
        original = (
            '<?xml version="1.0"?>\n'
            '<schema>\n'
            '  <table name="cp_feed" resource="default" engine="innodb">\n'
            '    <column name="entity_id" xsi:type="int" identity="true" primary="true"/>\n'
            '    <column name="sku" xsi:type="varchar" length="64" primary="false"/>\n'
            '  </table>\n'
            '  <table name="cp_feed_item" resource="default" engine="innodb">\n'
            '    <column name="item_id" xsi:type="int" identity="true" primary="true"/>\n'
            '  </table>\n'
            '</schema>\n'
        )
        updated, summaries = _fix_db_schema_content(original)
        self.assertNotIn('primary="', updated)
        self.assertIn('<constraint xsi:type="primary" referenceId="PRIMARY">', updated)
        self.assertIn('<column name="entity_id"/>', updated)
        self.assertIn('<column name="item_id"/>', updated)
        self.assertEqual(updated.count('<constraint xsi:type="primary"'), 2)
        self.assertTrue(any("primary attribute" in s for s in summaries))

    def test_analyze_malformed_db_schema(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/db_schema.xml"
            self._write_schema(
                cwd,
                rel,
                (
                    '<?xml version="1.0"?>\n'
                    "<schema>\n"
                    '  <table name="broken">\n'
                    '    <column name="entity_id" />\n'
                    "  </table>\n"
                    '  <table name="broken">\n'
                    '    <column name="entity_id" />\n'
                    "</schema>\n"
                ),
            )

            deploy = {
                "ok": False,
                "steps": [
                    {
                        "key": "setup_upgrade",
                        "ok": False,
                        "skipped": False,
                        "output": MALFORMED_DB_SCHEMA_OUTPUT,
                    },
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            self.assertTrue(
                any(i["kind"] == "db_schema_malformed" for i in analysis["issues"])
            )
            self.assertIn(rel, analysis["errorFiles"])

    def test_build_auto_fix_proposals_column_primary(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/db_schema.xml"
            original = (
                '<?xml version="1.0"?>\n'
                '<schema>\n'
                '  <table name="cp_feed" resource="default" engine="innodb">\n'
                '    <column name="entity_id" xsi:type="int" identity="true" primary="true"/>\n'
                '  </table>\n'
                '</schema>\n'
            )
            self._write_schema(cwd, rel, original)

            analysis = analyze_deploy_failure({
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": COLUMN_PRIMARY_OUTPUT},
                ],
            }, cwd)
            proposal = build_auto_fix_proposals(cwd, analysis)
            self.assertIsNotNone(proposal)
            fixed = proposal["files"][0]["content"]
            self.assertNotIn('primary="', fixed)
            self.assertIn('<constraint xsi:type="primary" referenceId="PRIMARY">', fixed)

    def test_apply_auto_fix_replaces_constraint_columns(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/db_schema.xml"
            original = (
                '<?xml version="1.0"?>\n'
                '<schema><table>'
                '<constraint xsi:type="primary" referenceId="PRIMARY" columns="entity_id" />'
                '</table></schema>\n'
            )
            self._write_schema(cwd, rel, original)

            analysis = analyze_deploy_failure({
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": CONSTRAINT_COLUMNS_OUTPUT},
                ],
            }, cwd)
            applied = apply_auto_fixes(cwd, analysis)
            self.assertEqual(len(applied), 1)
            with open(os.path.join(cwd, rel), encoding="utf-8") as fp:
                updated = fp.read()
            self.assertIn('<column name="entity_id" />', updated)
            self.assertNotIn('columns="entity_id"', updated)

    def test_enrich_deploy_report_adds_analysis(self):
        with tempfile.TemporaryDirectory() as cwd:
            report = enrich_deploy_report({
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": CONSTRAINT_COLUMNS_OUTPUT},
                ],
            }, cwd)
            self.assertIn("analysis", report)
            self.assertFalse(report["ok"])

    def test_analyze_webapi_xml_validation_error(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/webapi.xml"
            self._write_schema(cwd, rel, BROKEN_WEBAPI)

            deploy = {
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": WEBAPI_XML_OUTPUT},
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            self.assertEqual(analysis["failedStep"], "setup_upgrade")
            self.assertIn(rel, analysis["errorFiles"])
            self.assertTrue(any(i["kind"] == "webapi_invalid" for i in analysis["issues"]))
            self.assertTrue(analysis["autoFixable"])
            self.assertIn("webapi.xml", analysis["summary"].lower())

    def test_analyze_webapi_routes_wrong_schema_error(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/webapi.xml"
            self._write_schema(cwd, rel, BROKEN_WEBAPI_ROUTES_WRONG_SCHEMA)

            deploy = {
                "ok": False,
                "steps": [
                    {
                        "key": "setup_upgrade",
                        "ok": False,
                        "skipped": False,
                        "output": WEBAPI_ROUTES_WRONG_SCHEMA_OUTPUT,
                    },
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            self.assertTrue(analysis["autoFixable"])
            proposal = build_auto_fix_proposals(cwd, analysis)
            self.assertIsNotNone(proposal)
            fixed = proposal["files"][0]["content"]
            self.assertIn(WEBAPI_CORRECT_SCHEMA, fixed)
            self.assertNotIn("framework:Webapi/etc/webapi.xsd", fixed)

    def test_build_auto_fix_proposals_webapi_config_root(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/webapi.xml"
            self._write_schema(cwd, rel, BROKEN_WEBAPI)

            analysis = analyze_deploy_failure({
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": WEBAPI_XML_OUTPUT},
                ],
            }, cwd)
            proposal = build_auto_fix_proposals(cwd, analysis)
            self.assertIsNotNone(proposal)
            self.assertEqual(proposal["files"][0]["path"], rel)
            self.assertIn("<routes", proposal["files"][0]["content"])
            self.assertNotIn("<config", proposal["files"][0]["content"])
            self.assertIn(WEBAPI_CORRECT_SCHEMA, proposal["files"][0]["content"])

    def test_fix_webapi_content_replaces_config_root(self):
        fixed, summaries = _fix_webapi_content(BROKEN_WEBAPI)
        self.assertIn("<routes", fixed)
        self.assertNotIn("<config", fixed)
        self.assertIn(WEBAPI_CORRECT_SCHEMA, fixed)
        self.assertNotIn("framework:Webapi/etc/webapi.xsd", fixed)
        self.assertTrue(summaries)

    def test_fix_webapi_content_wrong_schema_on_routes_root(self):
        fixed, summaries = _fix_webapi_content(BROKEN_WEBAPI_ROUTES_WRONG_SCHEMA)
        self.assertIn("<routes", fixed)
        self.assertIn(WEBAPI_CORRECT_SCHEMA, fixed)
        self.assertNotIn("framework:Webapi/etc/webapi.xsd", fixed)
        self.assertTrue(summaries)

    def test_gather_deploy_fix_excerpts_prioritizes_error_file(self):
        with tempfile.TemporaryDirectory() as cwd:
            webapi_rel = "app/code/Commercepundit/BocaBargoons/etc/webapi.xml"
            schema_rel = "app/code/Commercepundit/BocaBargoons/etc/db_schema.xml"
            self._write_schema(cwd, webapi_rel, "<routes></routes>\n")
            self._write_schema(cwd, schema_rel, "<schema></schema>\n")

            deploy = {
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": WEBAPI_XML_OUTPUT},
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            excerpts = gather_deploy_fix_excerpts(cwd, deploy, analysis)
            paths = [e["path"] for e in excerpts]
            self.assertIn(webapi_rel, paths)
            self.assertNotIn(schema_rel, paths)

    def test_analyze_php_fatal_error(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Vendor/Module/Model/Feed.php"
            self._write_schema(cwd, rel, "<?php\nclass Feed {}\n")

            output = (
                "Fatal error: Uncaught Error: Call to undefined method "
                f"in /var/www/html/{rel} on line 12"
            )
            deploy = {
                "ok": False,
                "steps": [
                    {"key": "setup_upgrade", "ok": False, "skipped": False, "output": output},
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            self.assertIn(rel, analysis["errorFiles"])
            self.assertTrue(any(i["kind"] == "php_runtime" for i in analysis["issues"]))

    def test_analyze_webapi_route_missing_resources_without_file_path(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/webapi.xml"
            self._write_schema(cwd, rel, BROKEN_WEBAPI_MISSING_RESOURCES)

            deploy = {
                "ok": False,
                "steps": [
                    {
                        "key": "setup_upgrade",
                        "ok": False,
                        "skipped": False,
                        "output": WEBAPI_MISSING_RESOURCES_OUTPUT,
                    },
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            self.assertNotIn("Unrecognized deploy error", analysis["summary"])
            self.assertTrue(analysis["autoFixable"])
            self.assertTrue(
                any(i["kind"] == "webapi_route_missing_resources" for i in analysis["issues"])
            )
            self.assertIn(rel, analysis["errorFiles"])

    def test_build_auto_fix_proposals_adds_resources_to_routes(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/etc/webapi.xml"
            self._write_schema(cwd, rel, BROKEN_WEBAPI_MISSING_RESOURCES)

            analysis = analyze_deploy_failure({
                "ok": False,
                "steps": [
                    {
                        "key": "setup_upgrade",
                        "ok": False,
                        "skipped": False,
                        "output": WEBAPI_MISSING_RESOURCES_OUTPUT,
                    },
                ],
            }, cwd)
            proposal = build_auto_fix_proposals(cwd, analysis)
            self.assertIsNotNone(proposal)
            fixed = proposal["files"][0]["content"]
            self.assertEqual(fixed.count("<resources>"), 3)
            self.assertIn('<resource ref="anonymous"/>', fixed)

    def test_analyze_magento_di_compile_php_syntax_error(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Commercepundit/BocaBargoons/Model/ProductFeedBuilder.php"
            self._write_schema(cwd, rel, "<?php\nclass ProductFeedBuilder {\n}\n")

            progress = "Proxies code generation... 11%\n" * 400
            error = (
                f"There is an error in /var/www/html/{rel}\n"
                "Unmatched '}'\n"
                f"in {rel} on line 45\n"
            )
            output = progress + error + "#11 /var/www/html/vendor/magento/framework/Console/Cli.php\n"

            deploy = {
                "ok": False,
                "steps": [
                    {"key": "di_compile", "ok": False, "skipped": False, "output": output},
                ],
            }
            analysis = analyze_deploy_failure(deploy, cwd)
            self.assertNotIn("Unrecognized deploy error", analysis["summary"])
            self.assertIn(rel, analysis["errorFiles"])
            self.assertTrue(any(i["kind"] == "php_syntax" for i in analysis["issues"]))

    def test_build_php_syntax_auto_fix_removes_extra_brace(self):
        with tempfile.TemporaryDirectory() as cwd:
            rel = "app/code/Vendor/Module/Model/Feed.php"
            broken = (
                "<?php\n"
                "namespace Vendor\\Module\\Model;\n"
                "class Feed {\n"
                "    public function run() {\n"
                "    }\n"
                "}\n"
                "}\n"
            )
            self._write_schema(cwd, rel, broken)

            analysis = analyze_deploy_failure({
                "ok": False,
                "steps": [{
                    "key": "di_compile",
                    "ok": False,
                    "skipped": False,
                    "output": (
                        f"There is an error in /var/www/html/{rel}\n"
                        "Unmatched '}'\n"
                        f"in {rel} on line 7\n"
                    ),
                }],
            }, cwd)

            proposal = build_php_syntax_auto_fix(cwd, analysis, php_bin="php")
            self.assertIsNotNone(proposal)
            fixed = proposal["files"][0]["content"]
            from services.agent_output_validator import _lint_php_content
            self.assertIsNone(_lint_php_content("php", fixed))
            self.assertEqual(fixed.count("}"), 2)

    def test_enrich_deploy_fix_analysis_maps_generated_error_to_app_code(self):
        source = "app/code/Bitbag/PDSlavery/Plugin/DbAdapterPlugin.php"
        deploy = {
            "ok": False,
            "steps": [{
                "key": "di_compile",
                "ok": False,
                "skipped": False,
                "output": (
                    "Parse error: syntax error in "
                    "/var/www/html/generated/code/Magento/Framework/DB/Adapter/"
                    "AdapterInterface/Interceptor.php on line 22\n"
                ),
            }],
        }
        detail = {
            "output": {
                "files": [{"path": source, "action": "modify"}],
            },
        }
        analysis = enrich_deploy_fix_analysis(
            analyze_deploy_failure(deploy, "/var/www/html"),
            detail,
            "/var/www/html",
        )
        self.assertTrue(analysis.get("generatedError"))
        self.assertIn(source, analysis.get("fixTargets") or [])
        self.assertIn(source, deploy_fix_target_paths(analysis))
        self.assertNotIn(
            "generated/code/Magento/Framework/DB/Adapter/AdapterInterface/Interceptor.php",
            deploy_fix_target_paths(analysis),
        )

    def test_merge_deploy_analysis_uses_stored_raw_output(self):
        deploy = {
            "ok": False,
            "steps": [],
            "analysis": {
                "rawOutput": "Parse error in /var/www/html/app/code/Vendor/Module/Model/Broken.php",
                "summary": "PHP error",
                "issues": [{"kind": "php_runtime", "file": "app/code/Vendor/Module/Model/Broken.php"}],
            },
        }
        merged = merge_deploy_analysis(deploy, "/var/www/html")
        self.assertIn("Parse error", merged.get("rawOutput") or "")
        self.assertTrue(merged.get("issues"))

    def test_enrich_maps_docker_absolute_generated_path(self):
        deploy = {
            "ok": False,
            "steps": [{
                "key": "di_compile",
                "ok": False,
                "skipped": False,
                "output": (
                    'PHP Fatal error: Cannot use "parent" when current class scope has no parent in '
                    "/var/www/html/generated/code/Magento/Framework/DB/Adapter/"
                    "AdapterInterface/Interceptor.php on line 22\n"
                ),
            }],
        }
        cwd = "/var/www/html/fabric5anddime_m2"
        detail = {
            "output": {
                "files": [{"path": "app/code/Belvg/POboxes/Test/Unit/Helper/DataTest.php"}],
            },
        }
        analysis = enrich_deploy_fix_analysis(
            analyze_deploy_failure(deploy, cwd),
            detail,
            cwd,
        )
        self.assertTrue(analysis.get("generatedError"))
        self.assertIn(
            "generated/code/Magento/Framework/DB/Adapter/AdapterInterface/Interceptor.php",
            analysis.get("errorFiles") or [],
        )
        self.assertTrue(analysis.get("fixTargets"))

    def test_storefront_layout_dom_error_targets_theme_files_not_plugin(self):
        layout_xml = (
            "app/design/frontend/Commercepundit/fabric5anddime/"
            "Magento_Theme/layout/default_head_blocks.xml"
        )
        phtml = (
            "app/design/frontend/Commercepundit/fabric5anddime/"
            "Magento_Theme/templates/gtm_head.phtml"
        )
        deploy = {
            "ok": False,
            "profileReason": "Composer or module setup changed (default_head_blocks.xml, gtm_head.phtml)",
            "steps": [{
                "key": "storefront_probe",
                "ok": False,
                "skipped": False,
                "output": (
                    "HTTP 500 — Magento storefront error\n"
                    "Exception: Magento\\Framework\\Config\\Dom\\ValidationException\n"
                    "Element 'script': The attribute 'src' is required but missing.\n"
                    "File: app/code/Mirasvit/RewardsBehavior/Plugin/CustomerSessionContext.php (line 47)\n"
                    "  • Element 'script': The attribute 'src' is required but missing.\n"
                    "  • Element 'noscript': This element is not expected.\n"
                ),
            }],
        }
        detail = {
            "deploy": deploy,
            "output": {
                "files": [
                    {"path": layout_xml, "action": "modify"},
                    {"path": phtml, "action": "modify"},
                ],
            },
        }
        cwd = "/var/www/html/fabric5anddime_m2"
        analysis = enrich_deploy_fix_analysis(
            analyze_deploy_failure(deploy, cwd),
            detail,
            cwd,
        )
        self.assertTrue(any(i.get("kind") == "layout_dom_validation" for i in analysis.get("issues") or []))
        targets = deploy_fix_target_paths(analysis)
        self.assertIn(layout_xml, targets)
        self.assertIn(phtml, targets)
        self.assertNotIn(
            "app/code/Mirasvit/RewardsBehavior/Plugin/CustomerSessionContext.php",
            targets,
        )


if __name__ == "__main__":
    unittest.main()
