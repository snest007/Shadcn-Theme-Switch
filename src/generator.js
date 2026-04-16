import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALPHA_STEPS,
  BLUEPRINT_FILES,
  CUSTOM_LAYOUT_RULES,
  CUSTOM_TYPOGRAPHY_RULES,
  FILE_NAMES,
  ICON_LIBRARY_LABELS,
  MODE_BASE_SLOTS,
  RAW_COLOR_PREFIXES,
} from "./constants.js";
import { applyAlpha, isColorObject, makeColor, sameColor, sameRgb } from "./color.js";
import { readJson, writeJson } from "./file-utils.js";
import { applyThemeContractToThemeTokens, applyThemeDeclarationsToContract, themeTokenTreeToContract } from "./theme-contract.js";
import { mergedTokenContext, resolveTokenChain, resolveTokenValue } from "./token-tree.js";
import {
  aliasTargetToRef,
  getIn,
  isPlainObject,
  isTokenLeaf,
  refToSegments,
  roundNumber,
  setIn,
  summarizeValue,
  tokenRef,
  walkTokenLeaves,
} from "./utils.js";
import { hydratePresetSource, loadProjectSource } from "./project.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BLUEPRINT_DIR = path.resolve(__dirname, "..", "blueprints");

function sanitizeRootExtensions(sourceExtensions, fileName) {
  const modeName = sourceExtensions?.["com.figma.modeName"];
  const generator = {
    blueprintFile: fileName,
  };

  if (modeName) {
    generator.modeName = modeName;
  }

  return { generator };
}

function sanitizeTokenLeaf(node) {
  const result = {
    $type: node.$type,
  };

  if (typeof node.$value === "string") {
    result.$value = node.$value;
  } else if (node.$extensions?.["com.figma.aliasData"]?.targetVariableName) {
    result.$value = aliasTargetToRef(node.$extensions["com.figma.aliasData"].targetVariableName);
  } else {
    result.$value = node.$value;
  }

  if (node.$description) {
    result.$description = node.$description;
  }

  const scopes = node.$extensions?.["com.figma.scopes"];
  if (Array.isArray(scopes) && scopes.length > 0) {
    result.$extensions = { scopes: [...scopes] };
  }

  return result;
}

function sanitizeBlueprintTree(node, fileName) {
  if (!isPlainObject(node)) {
    return node;
  }

  if (isTokenLeaf(node)) {
    return sanitizeTokenLeaf(node);
  }

  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$extensions") {
      result.$extensions = sanitizeRootExtensions(value, fileName);
      continue;
    }
    result[key] = sanitizeBlueprintTree(value, fileName);
  }
  return result;
}

export function loadBlueprints(blueprintDir = DEFAULT_BLUEPRINT_DIR) {
  const blueprints = {};
  for (const fileName of BLUEPRINT_FILES) {
    blueprints[fileName] = sanitizeBlueprintTree(readJson(path.join(blueprintDir, fileName)), fileName);
  }
  return blueprints;
}

export function getDefaultThemeContract(blueprintDir = DEFAULT_BLUEPRINT_DIR) {
  const blueprints = loadBlueprints(blueprintDir);
  return themeTokenTreeToContract(
    blueprints[FILE_NAMES.theme],
    mergedTokenContext(blueprints[FILE_NAMES.tailwind], blueprints[FILE_NAMES.theme]),
  );
}

function copyMeta(node, nextValue) {
  const result = {
    $type: node.$type,
    $value: nextValue,
  };

  if (node.$description) {
    result.$description = node.$description;
  }

  if (node.$extensions?.scopes?.length) {
    result.$extensions = { scopes: [...node.$extensions.scopes] };
  }

  return result;
}

function readToken(tree, tokenPath) {
  return getIn(tree, tokenPath.split("."));
}

function writeToken(tree, tokenPath, node) {
  setIn(tree, tokenPath.split("."), node);
}

function recordSource(sourceMaps, fileName, tokenPath, details) {
  sourceMaps[fileName][tokenPath] = details;
}

function candidateMeta(ref) {
  const segments = refToSegments(ref);
  return {
    ref,
    namespace: segments[0],
    name: segments.slice(1).join("."),
    segments,
  };
}

function normalizeKey(key) {
  return key.toLowerCase();
}

function desiredNamespaceForCustomKey(key) {
  const normalized = normalizeKey(key);
  if (normalized.startsWith("alpha-")) {
    return "alpha";
  }

  if (normalized === "outline" || normalized.startsWith("outline") || RAW_COLOR_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "tailwind colors";
  }

  return "base";
}

function scoreCandidate(key, candidate, phase) {
  const normalized = normalizeKey(key);
  const preferredNamespace = desiredNamespaceForCustomKey(key);
  let score = 0;

  if (candidate.namespace === preferredNamespace) {
    score -= 40;
  }
  if (phase === "exact") {
    score -= 20;
  }
  if (candidate.namespace === "base") {
    score -= 10;
  }
  if (candidate.namespace === "tailwind colors") {
    score -= 5;
  }
  if (candidate.namespace === "colors") {
    score -= 2;
  }
  if (candidate.namespace === "alpha") {
    score += 10;
  }

  for (const segment of candidate.segments.slice(1)) {
    const token = segment.toLowerCase();
    if (normalized.includes(token)) {
      score -= 15;
    }
  }

  if (candidate.namespace === "alpha" && normalized.startsWith("alpha-")) {
    score -= 50;
  }

  return score;
}

function collectColorCandidates(contextTree) {
  const candidates = [];

  walkTokenLeaves(contextTree, (node, tokenPath) => {
    if (node.$type !== "color") {
      return;
    }
    const ref = tokenRef(tokenPath);
    const resolved = resolveTokenValue(node.$value, contextTree);
    if (!isColorObject(resolved)) {
      return;
    }
    candidates.push({
      ...candidateMeta(ref),
      color: resolved,
    });
  });

  return candidates;
}

function compileColorRecipe(key, blueprintNode, blueprintCandidates) {
  if (typeof blueprintNode.$value === "string") {
    return {
      kind: "ref",
      ref: blueprintNode.$value,
    };
  }

  if (!isColorObject(blueprintNode.$value)) {
    return {
      kind: "literal",
      value: blueprintNode.$value,
    };
  }

  const exactCandidates = blueprintCandidates.filter((candidate) => sameColor(candidate.color, blueprintNode.$value));
  if (normalizeKey(key).startsWith("alpha-") && exactCandidates.length > 0) {
    const best = [...exactCandidates].sort((left, right) => scoreCandidate(key, left, "exact") - scoreCandidate(key, right, "exact"))[0];
    return { kind: "ref", ref: best.ref };
  }

  const exactNonAlpha = exactCandidates.filter((candidate) => candidate.namespace !== "alpha");
  if (exactNonAlpha.length > 0) {
    const best = [...exactNonAlpha].sort((left, right) => scoreCandidate(key, left, "exact") - scoreCandidate(key, right, "exact"))[0];
    return { kind: "ref", ref: best.ref };
  }

  const derivedCandidates = blueprintCandidates
    .filter((candidate) => sameRgb(candidate.color, blueprintNode.$value) && (candidate.color.alpha ?? 1) > 0)
    .map((candidate) => ({
      ...candidate,
      factor: roundNumber((blueprintNode.$value.alpha ?? 1) / (candidate.color.alpha ?? 1), 6),
    }))
    .filter((candidate) => candidate.factor >= 0 && candidate.factor <= 1.001);

  const derivedNonAlpha = derivedCandidates.filter((candidate) => candidate.namespace !== "alpha");
  if (derivedNonAlpha.length > 0) {
    const best = [...derivedNonAlpha].sort((left, right) => scoreCandidate(key, left, "derived") - scoreCandidate(key, right, "derived"))[0];
    return { kind: "alpha-derived", ref: best.ref, factor: best.factor };
  }

  if (exactCandidates.length > 0) {
    const best = [...exactCandidates].sort((left, right) => scoreCandidate(key, left, "exact") - scoreCandidate(key, right, "exact"))[0];
    return { kind: "ref", ref: best.ref };
  }

  if (derivedCandidates.length > 0) {
    const best = [...derivedCandidates].sort((left, right) => scoreCandidate(key, left, "derived") - scoreCandidate(key, right, "derived"))[0];
    return { kind: "alpha-derived", ref: best.ref, factor: best.factor };
  }

  return {
    kind: "literal",
    value: blueprintNode.$value,
  };
}

function applyColorRecipe(recipe, contextTree) {
  if (recipe.kind === "ref") {
    return recipe.ref;
  }

  if (recipe.kind === "alpha-derived") {
    const baseColor = resolveTokenValue(recipe.ref, contextTree);
    return applyAlpha(baseColor, recipe.factor);
  }

  return recipe.value;
}

function buildRawColorCandidates(tailwindTokens) {
  const context = mergedTokenContext(tailwindTokens);
  return collectColorCandidates(context).filter((candidate) => candidate.namespace === "tailwind colors");
}

function buildModeBaseTokens(modeTokens, modeName, sourceMaps) {
  for (const slot of MODE_BASE_SLOTS) {
    const token = readToken(modeTokens, `base.${slot}`);
    if (!token) {
      continue;
    }

    const themeColor = slot === "ring-offset" ? `background-${modeName}` : `${slot}-${modeName}`;
    writeToken(modeTokens, `base.${slot}`, copyMeta(token, tokenRef(["colors", themeColor])));
    recordSource(sourceMaps, modeName === "light" ? FILE_NAMES.modeLight : FILE_NAMES.modeDark, `base.${slot}`, {
      source: "theme-alias",
      detail: `colors.${themeColor}`,
    });
  }
}

function buildModeAlphaTokens(modeTokens, modeName, themeTokens, tailwindTokens, sourceMaps) {
  const backgroundToken = readToken(themeTokens, `colors.background-${modeName}`);
  const backgroundColor = resolveTokenValue(backgroundToken.$value, mergedTokenContext(tailwindTokens, themeTokens));
  const fileName = modeName === "light" ? FILE_NAMES.modeLight : FILE_NAMES.modeDark;

  for (const step of ALPHA_STEPS) {
    const token = readToken(modeTokens, `alpha.${step}`);
    if (!token) {
      continue;
    }
    const alphaValue = roundNumber(1 - step / 100, 12);
    writeToken(modeTokens, `alpha.${step}`, copyMeta(token, makeColor(backgroundColor.components, alphaValue)));
    recordSource(sourceMaps, fileName, `alpha.${step}`, {
      source: "derived-alpha",
      detail: `background-${modeName} x ${alphaValue}`,
    });
  }
}

function compileCustomRecipes(blueprints) {
  const blueprintTheme = blueprints[FILE_NAMES.theme];
  const blueprintTailwind = blueprints[FILE_NAMES.tailwind];
  const recipeTable = {};

  for (const [modeName, fileName] of [
    ["light", FILE_NAMES.modeLight],
    ["dark", FILE_NAMES.modeDark],
  ]) {
    const blueprintMode = blueprints[fileName];
    const blueprintContext = mergedTokenContext(blueprintTailwind, blueprintTheme, {
      base: blueprintMode.base,
      alpha: blueprintMode.alpha,
    });
    const candidates = collectColorCandidates(blueprintContext);

    recipeTable[modeName] = {};
    for (const [key, node] of Object.entries(blueprintMode.custom)) {
      recipeTable[modeName][key] = compileColorRecipe(key, node, candidates);
    }
  }

  return recipeTable;
}

function buildModeCustomTokens(modeTokens, modeName, themeTokens, tailwindTokens, customRecipes, sourceMaps) {
  const context = mergedTokenContext(tailwindTokens, themeTokens, {
    base: modeTokens.base,
    alpha: modeTokens.alpha,
  });
  const fileName = modeName === "light" ? FILE_NAMES.modeLight : FILE_NAMES.modeDark;

  for (const [key, recipe] of Object.entries(customRecipes[modeName])) {
    const token = readToken(modeTokens, `custom.${key}`);
    if (!token) {
      continue;
    }

    const nextValue = applyColorRecipe(recipe, context);
    writeToken(modeTokens, `custom.${key}`, copyMeta(token, nextValue));
    recordSource(sourceMaps, fileName, `custom.${key}`, {
      source: recipe.kind,
      detail: recipe.ref ? `${recipe.ref}${recipe.factor ? ` x ${recipe.factor}` : ""}` : "blueprint literal",
    });
  }
}

function buildCustomCollection(collectionTokens, viewport, sourceMaps) {
  const fileName = viewport === "mobile" ? FILE_NAMES.customMobile : FILE_NAMES.customDesktop;

  for (const [tokenName, refPath] of Object.entries(CUSTOM_LAYOUT_RULES[viewport])) {
    const token = readToken(collectionTokens, tokenName);
    writeToken(collectionTokens, tokenName, copyMeta(token, tokenRef(refPath)));
    recordSource(sourceMaps, fileName, tokenName, {
      source: "fixed-rule",
      detail: refPath,
    });
  }

  for (const [tokenName, rule] of Object.entries(CUSTOM_TYPOGRAPHY_RULES[viewport])) {
    for (const [property, value] of Object.entries({
      "font-family": tokenRef("font.font-sans"),
      "font-size": tokenRef(`text.${rule.scale}.font-size`),
      "line-height": tokenRef(`text.${rule.scale}.line-height`),
      "font-weight": tokenRef("font-weight.semibold"),
      "letter-spacing": rule.letterSpacing,
    })) {
      const token = readToken(collectionTokens, `${tokenName}.${property}`);
      writeToken(collectionTokens, `${tokenName}.${property}`, copyMeta(token, value));
      recordSource(sourceMaps, fileName, `${tokenName}.${property}`, {
        source: property === "letter-spacing" ? "fixed-rule" : "theme-alias",
        detail: typeof value === "string" ? value : String(value),
      });
    }
  }
}

function buildIconLibraryTokens(iconTokens, iconLibrary, sourceMaps) {
  if (!Object.hasOwn(ICON_LIBRARY_LABELS, iconLibrary)) {
    throw new Error(`Unsupported icon library "${iconLibrary}". Supported values: ${Object.keys(ICON_LIBRARY_LABELS).join(", ")}`);
  }

  for (const [libraryKey, label] of Object.entries(ICON_LIBRARY_LABELS)) {
    const token = readToken(iconTokens, label);
    writeToken(iconTokens, label, copyMeta(token, libraryKey === iconLibrary ? 1 : 0));
    recordSource(sourceMaps, FILE_NAMES.iconLibrary, label, {
      source: "components-json",
      detail: iconLibrary,
    });
  }
}

export function collectReferenceErrors(files) {
  const contexts = {
    [FILE_NAMES.tailwind]: mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme]),
    [FILE_NAMES.theme]: mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme]),
    [FILE_NAMES.modeLight]: mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme], files[FILE_NAMES.modeLight]),
    [FILE_NAMES.modeDark]: mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme], files[FILE_NAMES.modeDark]),
    [FILE_NAMES.customMobile]: mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme], files[FILE_NAMES.customMobile]),
    [FILE_NAMES.customDesktop]: mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme], files[FILE_NAMES.customDesktop]),
    [FILE_NAMES.iconLibrary]: mergedTokenContext(files[FILE_NAMES.iconLibrary]),
  };

  const errors = [];
  for (const [fileName, tree] of Object.entries(files)) {
    const context = contexts[fileName];
    walkTokenLeaves(tree, (node, tokenPath) => {
      if (typeof node.$value !== "string" || !node.$value.startsWith("{")) {
        return;
      }
      try {
        resolveTokenValue(node.$value, context);
      } catch (error) {
        errors.push(`${fileName}:${tokenPath.join(".")} -> ${error.message}`);
      }
    });
  }
  return errors;
}

function buildManifest(files, sourceMaps, projectSource, warnings, presetInfo = null) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: {
      mode: presetInfo ? "preset" : "project",
      preset: presetInfo?.preset ?? null,
      projectDir: projectSource.projectDir,
      cssPath: projectSource.cssPath,
      componentsPath: projectSource.componentsPath,
      iconLibrary: projectSource.components.iconLibrary,
    },
    warnings,
    files: {},
  };

  for (const [fileName, tree] of Object.entries(files)) {
    const context = (() => {
      switch (fileName) {
        case FILE_NAMES.tailwind:
        case FILE_NAMES.theme:
          return mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme]);
        case FILE_NAMES.modeLight:
          return mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme], files[FILE_NAMES.modeLight]);
        case FILE_NAMES.modeDark:
          return mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme], files[FILE_NAMES.modeDark]);
        case FILE_NAMES.customMobile:
          return mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme], files[FILE_NAMES.customMobile]);
        case FILE_NAMES.customDesktop:
          return mergedTokenContext(files[FILE_NAMES.tailwind], files[FILE_NAMES.theme], files[FILE_NAMES.customDesktop]);
        default:
          return mergedTokenContext(files[FILE_NAMES.iconLibrary]);
      }
    })();

    const tokens = {};
    walkTokenLeaves(tree, (node, tokenPath) => {
      const joinedPath = tokenPath.join(".");
      const chain = typeof node.$value === "string" && node.$value.startsWith("{") ? resolveTokenChain(node.$value, context) : { chain: [], value: node.$value };
      tokens[joinedPath] = {
        source: sourceMaps[fileName][joinedPath]?.source ?? "blueprint",
        detail: sourceMaps[fileName][joinedPath]?.detail ?? "blueprint fallback",
        value: summarizeValue(node.$value),
        resolvedValue: summarizeValue(chain.value),
        aliasChain: chain.chain,
      };
    });

    manifest.files[fileName] = {
      tokenCount: Object.keys(tokens).length,
      tokens,
    };
  }

  return manifest;
}

export function generateCollectionsFromSource(projectSource, { blueprintDir = DEFAULT_BLUEPRINT_DIR, presetInfo = null } = {}) {
  const blueprints = loadBlueprints(blueprintDir);
  const sourceMaps = Object.fromEntries([...BLUEPRINT_FILES, FILE_NAMES.manifest].map((fileName) => [fileName, {}]));
  const warnings = [];

  const tailwindTokens = blueprints[FILE_NAMES.tailwind];
  const themeTokens = blueprints[FILE_NAMES.theme];
  const modeLightTokens = blueprints[FILE_NAMES.modeLight];
  const modeDarkTokens = blueprints[FILE_NAMES.modeDark];
  const customMobileTokens = blueprints[FILE_NAMES.customMobile];
  const customDesktopTokens = blueprints[FILE_NAMES.customDesktop];
  const iconTokens = blueprints[FILE_NAMES.iconLibrary];

  const rawColorCandidates = buildRawColorCandidates(tailwindTokens);
  const defaultThemeContract = themeTokenTreeToContract(
    themeTokens,
    mergedTokenContext(tailwindTokens, themeTokens),
  );
  const themeContract = applyThemeDeclarationsToContract(defaultThemeContract, projectSource.declarations, {
    fonts: projectSource.fonts,
  });
  applyThemeContractToThemeTokens(themeTokens, themeContract, {
    rawColorCandidates,
    onWrite(tokenPath, details) {
      recordSource(sourceMaps, FILE_NAMES.theme, tokenPath, details);
    },
  });
  buildModeBaseTokens(modeLightTokens, "light", sourceMaps);
  buildModeBaseTokens(modeDarkTokens, "dark", sourceMaps);
  buildModeAlphaTokens(modeLightTokens, "light", themeTokens, tailwindTokens, sourceMaps);
  buildModeAlphaTokens(modeDarkTokens, "dark", themeTokens, tailwindTokens, sourceMaps);

  const customRecipes = compileCustomRecipes(blueprints);
  buildModeCustomTokens(modeLightTokens, "light", themeTokens, tailwindTokens, customRecipes, sourceMaps);
  buildModeCustomTokens(modeDarkTokens, "dark", themeTokens, tailwindTokens, customRecipes, sourceMaps);
  buildCustomCollection(customMobileTokens, "mobile", sourceMaps);
  buildCustomCollection(customDesktopTokens, "desktop", sourceMaps);
  buildIconLibraryTokens(iconTokens, projectSource.components.iconLibrary, sourceMaps);

  const files = {
    [FILE_NAMES.tailwind]: tailwindTokens,
    [FILE_NAMES.theme]: themeTokens,
    [FILE_NAMES.modeLight]: modeLightTokens,
    [FILE_NAMES.modeDark]: modeDarkTokens,
    [FILE_NAMES.customMobile]: customMobileTokens,
    [FILE_NAMES.customDesktop]: customDesktopTokens,
    [FILE_NAMES.iconLibrary]: iconTokens,
  };

  const referenceErrors = collectReferenceErrors(files);
  if (referenceErrors.length > 0) {
    throw new Error(`Reference validation failed:\n${referenceErrors.join("\n")}`);
  }

  return {
    files,
    manifest: buildManifest(files, sourceMaps, projectSource, warnings, presetInfo),
  };
}

export function writeCollections(outputDir, result) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [fileName, tree] of Object.entries(result.files)) {
    writeJson(path.join(outputDir, fileName), tree);
  }
  writeJson(path.join(outputDir, FILE_NAMES.manifest), result.manifest);
}

export function generateFromProject(projectDir, options = {}) {
  const projectSource = loadProjectSource(projectDir);
  return generateCollectionsFromSource(projectSource, options);
}

export function generateFromPreset(preset, options = {}) {
  const hydrated = hydratePresetSource({
    preset,
    base: options.base,
    template: options.template,
  });
  const projectSource = loadProjectSource(hydrated.projectDir);
  const result = generateCollectionsFromSource(projectSource, {
    blueprintDir: options.blueprintDir,
    presetInfo: {
      preset,
      hydratedProjectDir: hydrated.projectDir,
      command: hydrated.command,
    },
  });

  result.manifest.source.hydratedProjectDir = hydrated.projectDir;
  result.manifest.source.hydrateCommand = hydrated.command;
  return result;
}
