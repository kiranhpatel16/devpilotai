import unittest

from services.visual_test_service import (
    _resolve_auth_mode,
    resolve_visual_targets,
)


class ResolveVisualTargetsTests(unittest.TestCase):
    def test_login_register_task_uses_account_pages_not_homepage(self):
        targets = resolve_visual_targets(
            "https://shop.example.com",
            changed_paths=["app/design/frontend/Vendor/theme/Magento_Customer/templates/form/login.phtml"],
            manual_test_checklist=[
                "Open /customer/account/login — verify note is visible",
                "Open /customer/account/create — verify note is visible",
            ],
            task_context={
                "jiraSummary": "Add note in Login and register page",
                "userInstructions": "Show a note on login and register pages",
            },
        )
        paths = [p for _, p in targets]
        self.assertIn("/customer/account/login", paths)
        self.assertIn("/customer/account/create", paths)
        self.assertNotIn("/", paths)

    def test_login_and_register_inferred_from_task_text(self):
        targets = resolve_visual_targets(
            "https://shop.example.com",
            changed_paths=[],
            manual_test_checklist=None,
            task_context={"jiraSummary": "Add banner on login and register page"},
        )
        paths = [p for _, p in targets]
        self.assertIn("/customer/account/login", paths)
        self.assertIn("/customer/account/create", paths)

    def test_homepage_only_when_explicit_or_no_targets(self):
        targets = resolve_visual_targets(
            "https://shop.example.com",
            changed_paths=["app/design/frontend/Vendor/theme/web/css/styles.css"],
            manual_test_checklist=["Verify homepage hero section"],
            task_context={"summary": "Update homepage hero"},
        )
        paths = [p for _, p in targets]
        self.assertEqual(paths, ["/"])

    def test_checkout_task(self):
        targets = resolve_visual_targets(
            "https://shop.example.com",
            [],
            ["Complete checkout flow and verify banner"],
            {"jiraSummary": "Checkout banner"},
        )
        paths = [p for _, p in targets]
        self.assertIn("/checkout", paths)


class ResolveAuthModeTests(unittest.TestCase):
    def test_no_auth_for_public_login_register_pages(self):
        targets = [("Login", "/customer/account/login"), ("Register", "/customer/account/create")]
        self.assertEqual(_resolve_auth_mode({"jiraSummary": "login page note"}, targets), "none")

    def test_register_for_protected_account_dashboard(self):
        targets = [("Account", "/customer/account")]
        self.assertEqual(
            _resolve_auth_mode({"jiraSummary": "Add widget to customer account dashboard"}, targets),
            "register",
        )

    def test_no_dashboard_when_only_login_register_pages(self):
        targets = resolve_visual_targets(
            "https://shop.example.com",
            [],
            None,
            {"jiraSummary": "Add note in Login and register page"},
        )
        paths = [p for _, p in targets]
        self.assertIn("/customer/account/login", paths)
        self.assertIn("/customer/account/create", paths)
        self.assertNotIn("/customer/account", paths)


if __name__ == "__main__":
    unittest.main()
