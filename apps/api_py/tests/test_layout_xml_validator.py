"""Tests for layout XML validation."""

from services.layout_xml_validator import is_layout_xml_path, validate_layout_xml_content


def test_is_layout_xml_path():
    assert is_layout_xml_path(
        "app/design/frontend/Vendor/theme/Magento_Theme/layout/default_head_blocks.xml"
    )
    assert not is_layout_xml_path("app/code/Vendor/Module/etc/di.xml")


def test_detects_unescaped_ampersand():
    content = """<?xml version="1.0"?>
<page xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <head>
        <script src="https://example.com/pixel?id=1&ev=PageView"/>
    </head>
</page>
"""
    errors = validate_layout_xml_content(content, "default_head_blocks.xml")
    assert any("unescaped" in e.lower() for e in errors)


def test_valid_layout_xml():
    content = """<?xml version="1.0"?>
<page xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <head>
        <script src="https://example.com/pixel?id=1&amp;ev=PageView"/>
    </head>
</page>
"""
    assert validate_layout_xml_content(content) == []
