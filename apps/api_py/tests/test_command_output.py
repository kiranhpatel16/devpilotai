import unittest

from services.command_output import summarize_command_output


class CommandOutputTests(unittest.TestCase):
    def test_failed_output_preserves_magento_error_from_middle(self):
        progress = "Proxies code generation... 11%\n" * 500
        error = (
            "There is an error in /var/www/html/app/code/Vendor/Module/Model/Broken.php\n"
            "Unmatched '}'\n"
        )
        tail = "#11 /var/www/html/vendor/magento/framework/Console/Cli.php\n" * 200
        combined = progress + error + tail

        summary = summarize_command_output("", combined, ok=False)
        self.assertIn("There is an error in", summary)
        self.assertIn("Unmatched '}'", summary)


if __name__ == "__main__":
    unittest.main()
