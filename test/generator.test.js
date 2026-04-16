import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { readJson } from "../src/file-utils.js";
import { FILE_NAMES } from "../src/constants.js";
import { collectReferenceErrors, generateFromPreset, generateFromProject, writeCollections } from "../src/generator.js";
import { walkTokenLeaves } from "../src/utils.js";

function leafPaths(tree) {
  const paths = [];
  walkTokenLeaves(tree, (_, tokenPath) => {
    paths.push(tokenPath.join("."));
  });
  return paths.sort();
}

function sanitizeBlueprint(pathname) {
  return readJson(pathname);
}

test("generate bdvx03LE collections from preset", { timeout: 180_000 }, () => {
  const result = generateFromPreset("bdvx03LE");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadcn-figma-out-"));
  writeCollections(outputDir, result);

  const expectedFiles = [
    FILE_NAMES.tailwind,
    FILE_NAMES.theme,
    FILE_NAMES.modeLight,
    FILE_NAMES.modeDark,
    FILE_NAMES.customMobile,
    FILE_NAMES.customDesktop,
    FILE_NAMES.iconLibrary,
  ];

  assert.deepEqual(Object.keys(result.files).sort(), [...expectedFiles].sort());
  assert.equal(fs.existsSync(path.join(outputDir, FILE_NAMES.manifest)), true);

  for (const fileName of expectedFiles) {
    assert.equal(fs.existsSync(path.join(outputDir, fileName)), true);
    const blueprint = sanitizeBlueprint(path.join(process.cwd(), "blueprints", fileName));
    assert.deepEqual(leafPaths(result.files[fileName]), leafPaths(blueprint));
  }

  assert.equal(result.files[FILE_NAMES.modeLight].base.background.$value, "{colors.background-light}");
  assert.equal(result.files[FILE_NAMES.modeDark].base.background.$value, "{colors.background-dark}");
  assert.equal(result.files[FILE_NAMES.customMobile]["heading-xl"]["font-size"].$value, "{text.5xl.font-size}");
  assert.equal(result.files[FILE_NAMES.customDesktop]["section-padding-y"].$value, "{spacing.24}");
  assert.equal(result.files[FILE_NAMES.iconLibrary]["Lucide Icons"].$value, 1);

  const referenceErrors = collectReferenceErrors(result.files);
  assert.deepEqual(referenceErrors, []);

  const theme = result.files[FILE_NAMES.theme];
  assert.ok(theme.colors["primary-light"]);
  assert.ok(theme.colors["primary-dark"]);
  assert.equal(result.manifest.source.preset, "bdvx03LE");

  const hydratedProjectDir = result.manifest.source.hydratedProjectDir;
  assert.equal(typeof hydratedProjectDir, "string");
  assert.equal(fs.existsSync(hydratedProjectDir), true);

  const fromProject = generateFromProject(hydratedProjectDir);
  assert.deepEqual(fromProject.files, result.files);
  assert.deepEqual(
    {
      warnings: fromProject.manifest.warnings,
      files: fromProject.manifest.files,
    },
    {
      warnings: result.manifest.warnings,
      files: result.manifest.files,
    },
  );
  assert.equal(fromProject.manifest.source.mode, "project");
  assert.equal(fromProject.manifest.source.projectDir, hydratedProjectDir);
});
