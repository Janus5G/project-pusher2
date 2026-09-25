import json
import tempfile
import unittest
from pathlib import Path

import repodoc


class RepoDocTests(unittest.TestCase):
    def test_scan_detects_node_stack_and_sensitive_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "package.json").write_text(json.dumps({
                "name": "fixture",
                "scripts": {"test": "vitest"},
                "devDependencies": {"vite": "1", "vitest": "1"},
            }), encoding="utf-8")
            (root / "package-lock.json").write_text("{}", encoding="utf-8")
            (root / "app.js").write_text("export const value = 1;\n", encoding="utf-8")
            (root / ".env").write_text("SAFE_FIXTURE=value\n", encoding="utf-8")

            scan = repodoc.scan_project(root)
            self.assertEqual(scan["projectName"], "fixture")
            self.assertEqual(scan["projectType"], "Node")
            self.assertIn("Vite", scan["frameworks"])
            self.assertIn("Vitest", scan["frameworks"])
            self.assertEqual(scan["testCommands"], ["npm test"])
            self.assertTrue(any(".env" in warning for warning in scan["warnings"]))

    def test_generate_missing_never_overwrites(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "package.json").write_text(json.dumps({"name": "fixture"}), encoding="utf-8")
            (root / "README.md").write_text("KEEP\n", encoding="utf-8")
            summary = repodoc.scan_project(root)
            result = repodoc.generate_missing(root, summary)

            self.assertEqual((root / "README.md").read_text(encoding="utf-8"), "KEEP\n")
            self.assertIn("README.md", result["skippedExisting"])
            self.assertTrue((root / ".gitignore").exists())
            self.assertTrue((root / "SECURITY.md").exists())

    def test_generated_scan_is_json_serializable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "main.go").write_text("package main\n", encoding="utf-8")
            (root / "go.mod").write_text("module example.test/fixture\ngo 1.23\n", encoding="utf-8")
            payload = json.dumps(repodoc.scan_project(root), sort_keys=True)
            self.assertIn('"projectType": "Go"', payload)


if __name__ == "__main__":
    unittest.main()
