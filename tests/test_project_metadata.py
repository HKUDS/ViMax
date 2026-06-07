"""Tests for package metadata files."""

import pathlib
import tomllib
import unittest


class TestProjectMetadata(unittest.TestCase):
    def test_pyproject_readme_path_exists_case_sensitively(self):
        project_root = pathlib.Path(__file__).resolve().parents[1]
        pyproject = tomllib.loads((project_root / "pyproject.toml").read_text(encoding="utf-8"))

        readme_path = project_root / pyproject["project"]["readme"]

        self.assertTrue(readme_path.exists())
        self.assertEqual(readme_path.name, "readme.md")


if __name__ == "__main__":
    unittest.main()
