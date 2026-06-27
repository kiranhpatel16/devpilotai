"""Tests for Magento storefront error parsing."""

from services.magento_error_parser import (
    is_layout_head_dom_validation_error,
    parse_magento_storefront_error,
    parse_storefront_error_text,
)

SAMPLE_HTML = """
1 exception(s):
Exception #0 (Magento\\Framework\\Config\\Dom\\ValidationException):
Theme layout update file '/var/www/html/app/design/frontend/BlueAcorn/site/BlueAcorn_CmsFramework/layout/cmsframework_index_index.xml' is not valid.
invalid character in attribute value
 Line: 16
attributes construct error
 Line: 16
PCDATA invalid Char value 12
 Line: 16
"""

STOREFRONT_PROBE_TEXT = """HTTP 500 — Magento storefront error
Exception: Magento\\Framework\\Config\\Dom\\ValidationException
Element 'script': The attribute 'src' is required but missing.
File: app/code/Mirasvit/RewardsBehavior/Plugin/CustomerSessionContext.php (line 47)
  • Exception #0 (Magento\\Framework\\Config\\Dom\\ValidationException): Element 'script': The attribute 'src' is required but missing.
  • Element 'script': Character content is not allowed, because the content type is empty.
  • Element 'noscript': This element is not expected. Expected is one of ( title, css, link, meta, script, remove, attribute, font ).
"""


def test_parse_magento_layout_validation_error():
    result = parse_magento_storefront_error(SAMPLE_HTML)
    assert result is not None
    assert "ValidationException" in (result.get("type") or "")
    assert "cmsframework_index_index.xml" in (result.get("file") or "")
    assert result.get("line") == 16
    assert any("invalid character" in d.lower() for d in (result.get("details") or []))


def test_parse_returns_none_for_clean_html():
    assert parse_magento_storefront_error("<html><body>OK</body></html>") is None


def test_parse_storefront_probe_layout_dom_error():
    result = parse_storefront_error_text(STOREFRONT_PROBE_TEXT)
    assert result is not None
    assert is_layout_head_dom_validation_error(STOREFRONT_PROBE_TEXT, result)
    assert result.get("file") is None
    assert "CustomerSessionContext.php" in (result.get("stackFile") or "")
