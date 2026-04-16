import assert from "node:assert/strict";
import test from "node:test";

import { serializeCssColor, toFigmaColor } from "../src/color.js";
import { extractPrimaryFontFamily } from "../src/font-family.js";
import { getDefaultThemeContract } from "../src/generator.js";
import { parseThemeCssText, renderThemeCss } from "../src/theme-css.js";
import {
  TAILWIND_COLLECTION_NAME,
  applyRegistryToThemeContract,
  buildThemeVariableSpecs,
  diffThemeVariableSpecs,
  extractThemeBlueprintTailwindAliasMap,
  resolveThemeVariableSpecsToTailwindAliases,
} from "../src/theme-figma.js";
import { upsertManagedThemeBlock } from "../src/theme-files.js";
import { THEME_COLLECTION_NAMES, THEME_MODE_NAMES } from "../src/theme-schema.js";

function createRegistryFromSpecs(specs) {
  const registry = {
    collections: {},
  };

  for (const spec of specs) {
    if (!registry.collections[spec.collectionName]) {
      registry.collections[spec.collectionName] = {
        defaultModeName: null,
        modesByName: {},
        variablesByName: {},
      };
    }

    const collection = registry.collections[spec.collectionName];
    for (const modeName of Object.keys(spec.valuesByModeName)) {
      collection.modesByName[modeName] = {
        modeId: modeName,
        name: modeName,
      };
      collection.defaultModeName ??= modeName;
    }

    collection.variablesByName[spec.name] = {
      name: spec.name,
      resolvedType: spec.type,
      scopes: structuredClone(spec.scopes),
      valuesByModeName: structuredClone(spec.valuesByModeName),
    };
  }

  return registry;
}

function ensureRegistryCollection(registry, collectionName, modeName = THEME_MODE_NAMES.default) {
  if (!registry.collections[collectionName]) {
    registry.collections[collectionName] = {
      defaultModeName: modeName,
      modesByName: {},
      variablesByName: {},
    };
  }

  const collection = registry.collections[collectionName];
  collection.defaultModeName ??= modeName;
  if (!collection.modesByName[modeName]) {
    collection.modesByName[modeName] = {
      modeId: modeName,
      name: modeName,
    };
  }

  return collection;
}

function setRegistryVariable(
  registry,
  {
    collectionName,
    name,
    type,
    modeName = THEME_MODE_NAMES.default,
    scopes = [],
    modeValue,
  },
) {
  const collection = ensureRegistryCollection(registry, collectionName, modeName);
  collection.variablesByName[name] = {
    name,
    resolvedType: type,
    scopes: structuredClone(scopes),
    valuesByModeName: {
      [modeName]: structuredClone(modeValue),
    },
  };
}

function createValueModeValue(value) {
  return {
    kind: "VALUE",
    value,
  };
}

function createAliasModeValue(targetCollectionName, targetName, resolvedValue) {
  return {
    kind: "ALIAS",
    targetCollectionName,
    targetName,
    resolvedValue,
  };
}

test("renderThemeCss and parseThemeCssText round-trip the default contract", () => {
  const defaultContract = getDefaultThemeContract();
  const css = renderThemeCss(defaultContract);
  const parsed = parseThemeCssText(css);

  assert.equal(renderThemeCss(parsed), css);
});

test("upsertManagedThemeBlock inserts before @layer base and only replaces managed content", () => {
  const initialCss = `@import "tailwindcss";\n\n@layer base {\n  body {\n    color: red;\n  }\n}\n`;
  const firstBlock = "/* shadcn-theme:start */\n:root {\n  --background: #ffffff;\n}\n/* shadcn-theme:end */\n";
  const secondBlock = "/* shadcn-theme:start */\n:root {\n  --background: #000000;\n}\n/* shadcn-theme:end */\n";

  const inserted = upsertManagedThemeBlock(initialCss, firstBlock);
  assert.match(inserted, /\/\* shadcn-theme:start \*\/[\s\S]*@layer base/);
  assert.match(inserted, /color: red;/);

  const updated = upsertManagedThemeBlock(inserted, secondBlock);
  assert.equal(updated.includes("#ffffff"), false);
  assert.equal(updated.includes("#000000"), true);
  assert.match(updated, /color: red;/);
});

test("buildThemeVariableSpecs matches the expected theme + mode variable counts", () => {
  const defaultContract = getDefaultThemeContract();
  const specs = buildThemeVariableSpecs(defaultContract);
  const report = diffThemeVariableSpecs(specs, createRegistryFromSpecs(specs));

  assert.equal(specs.length, 215);
  assert.equal(report.create, 0);
  assert.equal(report.update, 0);
  assert.equal(report.conflict, 0);
  assert.equal(report.noOp, 215);
});

test("buildThemeVariableSpecs supports a custom Theme mode name without changing mode specs", () => {
  const defaultContract = getDefaultThemeContract();
  const customThemeModeName = "Imported 2026-04-13 15:20";
  const specs = buildThemeVariableSpecs(defaultContract, {
    themeModeName: customThemeModeName,
  });
  const themeSpecs = specs.filter((spec) => spec.collectionName === THEME_COLLECTION_NAMES.theme);
  const modeSpecs = specs.filter((spec) => spec.collectionName === THEME_COLLECTION_NAMES.mode);
  const registry = { collections: {} };

  assert.equal(specs.length, 215);
  for (const spec of themeSpecs) {
    assert.deepEqual(Object.keys(spec.valuesByModeName), [customThemeModeName]);
  }
  for (const spec of modeSpecs) {
    assert.deepEqual(Object.keys(spec.valuesByModeName), [THEME_MODE_NAMES.light, THEME_MODE_NAMES.dark]);
  }

  const backgroundSpec = themeSpecs.find((candidate) => candidate.name === "colors/background-light");
  setRegistryVariable(registry, {
    collectionName: TAILWIND_COLLECTION_NAME,
    name: "tailwind colors/base/white",
    type: "COLOR",
    modeValue: createValueModeValue(defaultContract.colors.background.light),
  });

  const { resolvedSpecs, resolutionReport } = resolveThemeVariableSpecsToTailwindAliases([backgroundSpec], registry);

  assert.deepEqual(resolvedSpecs[0].valuesByModeName[customThemeModeName], {
    kind: "ALIAS",
    targetCollectionName: TAILWIND_COLLECTION_NAME,
    targetName: "tailwind colors/base/white",
  });
  assert.equal(resolutionReport.tailwindAliasByBlueprint, 1);
});

test("applyRegistryToThemeContract reconstructs the contract from a normalized registry", () => {
  const defaultContract = getDefaultThemeContract();
  const specs = buildThemeVariableSpecs(defaultContract);
  const registry = createRegistryFromSpecs(specs);
  const rebuilt = applyRegistryToThemeContract(defaultContract, registry);

  assert.equal(renderThemeCss(rebuilt), renderThemeCss(defaultContract));
});

test("Figma-style color values are normalized for export and writeback", () => {
  const figmaColor = { r: 1, g: 0.5, b: 0, a: 0.25 };

  assert.equal(serializeCssColor(figmaColor), "rgb(255 128 0 / 0.25)");
  assert.deepEqual(toFigmaColor(figmaColor), figmaColor);
});

test("extractPrimaryFontFamily pulls the leading concrete family from a CSS stack", () => {
  assert.equal(
    extractPrimaryFontFamily("'Geist', 'Geist Fallback', ui-sans-serif, system-ui, sans-serif"),
    "Geist",
  );
  assert.equal(extractPrimaryFontFamily("Georgia, serif"), "Georgia");
  assert.equal(extractPrimaryFontFamily("Geist Mono"), "Geist Mono");
});

test("extractThemeBlueprintTailwindAliasMap exposes known color aliases", () => {
  const aliasMap = extractThemeBlueprintTailwindAliasMap();

  assert.equal(aliasMap["colors/background-light"], "tailwind colors/base/white");
  assert.equal(aliasMap["colors/primary-dark"], "tailwind colors/neutral/200");
});

test("resolveThemeVariableSpecsToTailwindAliases prefers blueprint color aliases", () => {
  const defaultContract = getDefaultThemeContract();
  const spec = buildThemeVariableSpecs(defaultContract).find((candidate) => candidate.name === "colors/background-light");
  const registry = { collections: {} };

  setRegistryVariable(registry, {
    collectionName: TAILWIND_COLLECTION_NAME,
    name: "tailwind colors/base/white",
    type: "COLOR",
    modeValue: createValueModeValue(defaultContract.colors.background.light),
  });

  const { resolvedSpecs, resolutionReport } = resolveThemeVariableSpecsToTailwindAliases([spec], registry);

  assert.deepEqual(resolvedSpecs[0].valuesByModeName[THEME_MODE_NAMES.default], {
    kind: "ALIAS",
    targetCollectionName: TAILWIND_COLLECTION_NAME,
    targetName: "tailwind colors/base/white",
  });
  assert.equal(resolutionReport.tailwindAliasByBlueprint, 1);
  assert.equal(resolutionReport.tailwindLiteralFallback, 0);
});

test("resolveThemeVariableSpecsToTailwindAliases uses the radius recipe before falling back", () => {
  const defaultContract = getDefaultThemeContract();
  const spec = buildThemeVariableSpecs(defaultContract).find((candidate) => candidate.name === "radius/lg");
  const registry = { collections: {} };

  setRegistryVariable(registry, {
    collectionName: TAILWIND_COLLECTION_NAME,
    name: "border-radius/rounded-lg",
    type: "FLOAT",
    modeValue: createValueModeValue(defaultContract.radius.lg),
  });

  const { resolvedSpecs, resolutionReport } = resolveThemeVariableSpecsToTailwindAliases([spec], registry);

  assert.deepEqual(resolvedSpecs[0].valuesByModeName[THEME_MODE_NAMES.default], {
    kind: "ALIAS",
    targetCollectionName: TAILWIND_COLLECTION_NAME,
    targetName: "border-radius/rounded-lg",
  });
  assert.equal(resolutionReport.tailwindAliasByRecipe, 1);
  assert.equal(resolutionReport.tailwindLiteralFallback, 0);
});

test("resolveThemeVariableSpecsToTailwindAliases compares font families by primary family name", () => {
  const defaultContract = getDefaultThemeContract();
  const spec = structuredClone(buildThemeVariableSpecs(defaultContract).find((candidate) => candidate.name === "font/font-sans"));
  spec.valuesByModeName[THEME_MODE_NAMES.default].value =
    "'Geist', 'Geist Fallback', ui-sans-serif, system-ui, -apple-system, sans-serif";

  const registry = { collections: {} };
  setRegistryVariable(registry, {
    collectionName: TAILWIND_COLLECTION_NAME,
    name: "font/sans",
    type: "STRING",
    scopes: ["FONT_FAMILY"],
    modeValue: createValueModeValue("Geist"),
  });

  const { resolvedSpecs, resolutionReport } = resolveThemeVariableSpecsToTailwindAliases([spec], registry);

  assert.deepEqual(resolvedSpecs[0].valuesByModeName[THEME_MODE_NAMES.default], {
    kind: "ALIAS",
    targetCollectionName: TAILWIND_COLLECTION_NAME,
    targetName: "font/sans",
  });
  assert.equal(resolutionReport.tailwindAliasByHeuristic, 1);
});

test("resolveThemeVariableSpecsToTailwindAliases keeps literal values when the tailwind namespace is missing", () => {
  const defaultContract = getDefaultThemeContract();
  const specs = buildThemeVariableSpecs(defaultContract).filter((candidate) =>
    ["blur/sm", "shadow/sm/1/offset-x"].includes(candidate.name),
  );
  const registry = { collections: {} };

  setRegistryVariable(registry, {
    collectionName: TAILWIND_COLLECTION_NAME,
    name: "spacing/1",
    type: "FLOAT",
    modeValue: createValueModeValue(specs[0].valuesByModeName[THEME_MODE_NAMES.default].value),
  });
  setRegistryVariable(registry, {
    collectionName: TAILWIND_COLLECTION_NAME,
    name: "spacing/2",
    type: "FLOAT",
    modeValue: createValueModeValue(specs[1].valuesByModeName[THEME_MODE_NAMES.default].value),
  });

  const { resolvedSpecs, resolutionReport } = resolveThemeVariableSpecsToTailwindAliases(specs, registry);

  for (const resolvedSpec of resolvedSpecs) {
    assert.equal(resolvedSpec.valuesByModeName[THEME_MODE_NAMES.default].kind, "VALUE");
  }
  assert.equal(resolutionReport.tailwindAliasResolved, 0);
  assert.equal(resolutionReport.tailwindLiteralFallback, 2);
});

test("resolveThemeVariableSpecsToTailwindAliases falls back cleanly when the tailwind collection is missing", () => {
  const defaultContract = getDefaultThemeContract();
  const spec = buildThemeVariableSpecs(defaultContract).find((candidate) => candidate.name === "colors/background-light");

  const { resolvedSpecs, resolutionReport } = resolveThemeVariableSpecsToTailwindAliases([spec], { collections: {} });

  assert.equal(resolvedSpecs[0].valuesByModeName[THEME_MODE_NAMES.default].kind, "VALUE");
  assert.equal(resolutionReport.tailwindMissingCollection, true);
  assert.equal(resolutionReport.tailwindLiteralFallback, 1);
});

test("resolved tailwind aliases upgrade matching theme literals and become idempotent on rerun", () => {
  const defaultContract = getDefaultThemeContract();
  const spec = buildThemeVariableSpecs(defaultContract).find((candidate) => candidate.name === "colors/background-light");
  const registryWithLiteralTheme = createRegistryFromSpecs([spec]);

  setRegistryVariable(registryWithLiteralTheme, {
    collectionName: TAILWIND_COLLECTION_NAME,
    name: "tailwind colors/base/white",
    type: "COLOR",
    modeValue: createValueModeValue(defaultContract.colors.background.light),
  });

  const { resolvedSpecs } = resolveThemeVariableSpecsToTailwindAliases([spec], registryWithLiteralTheme);
  const firstDiff = diffThemeVariableSpecs(resolvedSpecs, registryWithLiteralTheme);
  assert.equal(firstDiff.update, 1);

  const registryWithAliasTheme = createRegistryFromSpecs(resolvedSpecs);
  const secondDiff = diffThemeVariableSpecs(resolvedSpecs, registryWithAliasTheme);
  assert.equal(secondDiff.noOp, 1);
});

test("diffThemeVariableSpecs treats importing into a new Theme mode as creates, not updates to Default", () => {
  const defaultContract = getDefaultThemeContract();
  const existingSpecs = buildThemeVariableSpecs(defaultContract);
  const importedSpecs = buildThemeVariableSpecs(defaultContract, {
    themeModeName: "Imported 2026-04-13 15:20",
  });
  const registry = createRegistryFromSpecs(existingSpecs);
  const report = diffThemeVariableSpecs(importedSpecs, registry);
  const importedThemeSpecCount = importedSpecs.filter((spec) => spec.collectionName === THEME_COLLECTION_NAMES.theme).length;
  const modeSpecCount = importedSpecs.filter((spec) => spec.collectionName === THEME_COLLECTION_NAMES.mode).length;

  assert.equal(report.create, importedThemeSpecCount);
  assert.equal(report.noOp, modeSpecCount);
  assert.equal(report.update, 0);
  assert.equal(report.conflict, 0);
});

test("resolveThemeVariableSpecsToTailwindAliases skips self-referencing tailwind candidates to avoid cycles", () => {
  const defaultContract = getDefaultThemeContract();
  const spec = buildThemeVariableSpecs(defaultContract).find((candidate) => candidate.name === "radius/lg");
  const registry = { collections: {} };

  setRegistryVariable(registry, {
    collectionName: TAILWIND_COLLECTION_NAME,
    name: "border-radius/rounded-lg",
    type: "FLOAT",
    modeValue: createAliasModeValue(THEME_COLLECTION_NAMES.theme, "radius/lg", defaultContract.radius.lg),
  });

  const { resolvedSpecs, resolutionReport } = resolveThemeVariableSpecsToTailwindAliases([spec], registry);

  assert.equal(resolvedSpecs[0].valuesByModeName[THEME_MODE_NAMES.default].kind, "VALUE");
  assert.equal(resolutionReport.tailwindLiteralFallback, 1);
});
