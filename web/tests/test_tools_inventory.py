"""Inventory reports required and optional tool status independently."""
import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('check_tools', Path(__file__).resolve().parents[2] / 'scripts/check_tools.py')
check_tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_tools)


class InventoryTests(unittest.TestCase):
    def test_old_python_is_missing_even_without_optional_tools(self):
        output = io.StringIO()
        with mock.patch.object(check_tools.sys, 'version_info', (3, 8)), mock.patch.object(check_tools.shutil, 'which', return_value=None), contextlib.redirect_stdout(output):
            self.assertEqual(check_tools.main(), 1)
        self.assertTrue(output.getvalue().rstrip().endswith('MISSING required tools or capabilities'))
        self.assertIn('Optional node: missing', output.getvalue())
