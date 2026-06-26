"""Tests for Magento storefront error parsing."""

from services.magento_error_parser import parse_magento_storefront_error

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


def test_parse_magento_layout_validation_error():
    result = parse_magento_storefront_error(SAMPLE_HTML)
    assert result is not None
    assert "ValidationException" in (result.get("type") or "")
    assert "cmsframework_index_index.xml" in (result.get("file") or "")
    assert result.get("line") == 16
    assert any("invalid character" in d.lower() for d in (result.get("details") or []))


def test_parse_returns_none_for_clean_html():
    assert parse_magento_storefront_error("<html><body>OK</body></html>") is None
