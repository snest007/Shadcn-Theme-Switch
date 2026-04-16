import themeBlueprint from "../blueprints/2. Theme.tokens.json" with { type: "json" };
import { normalizeColor, sameColor } from "./color.js";
import { extractPrimaryFontFamily } from "./font-family.js";
import { cloneThemeContract } from "./theme-contract.js";
import {
  BLUR_SCALES,
  COLOR_VARIABLE_SCOPES,
  EFFECT_COLOR_SCOPES,
  EFFECT_FLOAT_SCOPES,
  EFFECT_GROUPS,
  EFFECT_LAYER_PROPERTY_KEYS,
  FONT_KEYS,
  FONT_TOKEN_KEYS,
  FONT_VARIABLE_SCOPES,
  RADIUS_KEYS,
  THEME_COLLECTION_NAMES,
  THEME_MODE_NAMES,
  THEME_SCHEMA,
  blurVariableName,
  colorVariableName,
  effectVariableName,
  fontVariableName,
  modeBaseVariableName,
  modeThemeColorVariableName,
  radiusVariableName,
} from "./theme-schema.js";
import { deepClone, walkTokenLeaves } from "./utils.js";

function buildSpec({ collectionName, name, type, scopes, valuesByModeName }) {
  return {
    collectionName,
    name,
    type,
    scopes,
    valuesByModeName,
  };
}

function literalValue(value) {
  return {
    kind: "VALUE",
    value,
  };
}

function aliasValue(targetCollectionName, targetName) {
  return {
    kind: "ALIAS",
    targetCollectionName,
    targetName,
  };
}

export const TAILWIND_COLLECTION_NAME = "1. TailwindCSS";

const SCALE_TOKENS = new Set([
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
]);

const THEME_TAILWIND_ALIAS_RECIPES = (() => {
  const recipes = {};
  for (const radiusKey of RADIUS_KEYS) {
    recipes[radiusVariableName(radiusKey)] = `border-radius/rounded-${radiusKey}`;
  }
  return recipes;
})();

function resolvedModeValue(modeValue) {
  if (!modeValue) {
    return undefined;
  }

  if (modeValue.kind === "ALIAS") {
    return modeValue.resolvedValue;
  }

  return modeValue.value;
}

function isFontFamilySpec(spec) {
  return spec.type === "STRING" && Array.isArray(spec.scopes) && spec.scopes.includes("FONT_FAMILY");
}

function normalizeStringValueForComparison(spec, value) {
  if (isFontFamilySpec(spec)) {
    return extractPrimaryFontFamily(value).toLowerCase();
  }

  return String(value);
}

function compareScalarValues(spec, left, right) {
  if (spec.type === "COLOR") {
    return sameColor(left, right);
  }

  if (spec.type === "FLOAT") {
    return Math.abs(Number(left) - Number(right)) <= 1e-4;
  }

  if (spec.type === "STRING") {
    return normalizeStringValueForComparison(spec, left) === normalizeStringValueForComparison(spec, right);
  }

  return left === right;
}

function pushCollectionCount(report, collectionName, bucket) {
  if (!report.byCollection[collectionName]) {
    report.byCollection[collectionName] = {
      create: 0,
      update: 0,
      noOp: 0,
      conflict: 0,
    };
  }

  report.byCollection[collectionName][bucket] += 1;
  report[bucket] += 1;
}

function readThemeModeValue(registry, variableName, modeName) {
  const collection = registry.collections[THEME_COLLECTION_NAMES.theme];
  const variable = collection?.variablesByName?.[variableName];
  if (!variable) {
    return undefined;
  }

  return resolvedModeValue(variable.valuesByModeName?.[modeName]);
}

export function extractThemeBlueprintTailwindAliasMap(themeTokens = themeBlueprint) {
  const aliasMap = {};

  walkTokenLeaves(themeTokens, (node, pathSegments) => {
    const aliasData = node.$extensions?.["com.figma.aliasData"];
    if (!aliasData || aliasData.targetVariableSetName !== TAILWIND_COLLECTION_NAME) {
      return;
    }

    aliasMap[pathSegments.join("/")] = aliasData.targetVariableName;
  });

  return aliasMap;
}

const THEME_BLUEPRINT_TAILWIND_ALIAS_MAP = extractThemeBlueprintTailwindAliasMap();

export function buildThemeVariableSpecs(contract, { themeModeName = THEME_MODE_NAMES.default } = {}) {
  const specs = [];

  for (const slot of THEME_SCHEMA.colorSlots) {
    specs.push(
      buildSpec({
        collectionName: THEME_COLLECTION_NAMES.theme,
        name: colorVariableName(slot, "light"),
        type: "COLOR",
        scopes: COLOR_VARIABLE_SCOPES,
        valuesByModeName: {
          [themeModeName]: literalValue(contract.colors[slot].light),
        },
      }),
    );
    specs.push(
      buildSpec({
        collectionName: THEME_COLLECTION_NAMES.theme,
        name: colorVariableName(slot, "dark"),
        type: "COLOR",
        scopes: COLOR_VARIABLE_SCOPES,
        valuesByModeName: {
          [themeModeName]: literalValue(contract.colors[slot].dark),
        },
      }),
    );
  }

  for (const fontKey of FONT_KEYS) {
    specs.push(
      buildSpec({
        collectionName: THEME_COLLECTION_NAMES.theme,
        name: fontVariableName(fontKey),
        type: "STRING",
        scopes: FONT_VARIABLE_SCOPES,
        valuesByModeName: {
          [themeModeName]: literalValue(contract.fonts[fontKey]),
        },
      }),
    );
  }

  for (const radiusKey of RADIUS_KEYS) {
    specs.push(
      buildSpec({
        collectionName: THEME_COLLECTION_NAMES.theme,
        name: radiusVariableName(radiusKey),
        type: "FLOAT",
        scopes: [],
        valuesByModeName: {
          [themeModeName]: literalValue(contract.radius[radiusKey]),
        },
      }),
    );
  }

  for (const [groupKey, group] of Object.entries(EFFECT_GROUPS)) {
    for (const scale of group.scales) {
      const layerCount = group.layers[scale];
      for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
        const layer = contract.effects[groupKey][scale][layerIndex];
        if (!layer) {
          continue;
        }
        const specLayerIndex = layerCount > 1 ? layerIndex + 1 : null;
        specs.push(
          buildSpec({
            collectionName: THEME_COLLECTION_NAMES.theme,
            name: effectVariableName(groupKey, scale, "offsetX", specLayerIndex),
            type: "FLOAT",
            scopes: EFFECT_FLOAT_SCOPES,
            valuesByModeName: {
              [themeModeName]: literalValue(layer.offsetX),
            },
          }),
        );
        specs.push(
          buildSpec({
            collectionName: THEME_COLLECTION_NAMES.theme,
            name: effectVariableName(groupKey, scale, "offsetY", specLayerIndex),
            type: "FLOAT",
            scopes: EFFECT_FLOAT_SCOPES,
            valuesByModeName: {
              [themeModeName]: literalValue(layer.offsetY),
            },
          }),
        );
        specs.push(
          buildSpec({
            collectionName: THEME_COLLECTION_NAMES.theme,
            name: effectVariableName(groupKey, scale, "blur", specLayerIndex),
            type: "FLOAT",
            scopes: EFFECT_FLOAT_SCOPES,
            valuesByModeName: {
              [themeModeName]: literalValue(layer.blur),
            },
          }),
        );
        specs.push(
          buildSpec({
            collectionName: THEME_COLLECTION_NAMES.theme,
            name: effectVariableName(groupKey, scale, "spread", specLayerIndex),
            type: "FLOAT",
            scopes: EFFECT_FLOAT_SCOPES,
            valuesByModeName: {
              [themeModeName]: literalValue(layer.spread),
            },
          }),
        );
        specs.push(
          buildSpec({
            collectionName: THEME_COLLECTION_NAMES.theme,
            name: effectVariableName(groupKey, scale, "color", specLayerIndex),
            type: "COLOR",
            scopes: EFFECT_COLOR_SCOPES,
            valuesByModeName: {
              [themeModeName]: literalValue(layer.color),
            },
          }),
        );
      }
    }
  }

  for (const scale of BLUR_SCALES) {
    specs.push(
      buildSpec({
        collectionName: THEME_COLLECTION_NAMES.theme,
        name: blurVariableName(scale),
        type: "FLOAT",
        scopes: EFFECT_FLOAT_SCOPES,
        valuesByModeName: {
          [themeModeName]: literalValue(contract.effects.blur[scale]),
        },
      }),
    );
  }

  for (const slot of THEME_SCHEMA.modeBaseSlots) {
    specs.push(
      buildSpec({
        collectionName: THEME_COLLECTION_NAMES.mode,
        name: modeBaseVariableName(slot),
        type: "COLOR",
        scopes: COLOR_VARIABLE_SCOPES,
        valuesByModeName: {
          [THEME_MODE_NAMES.light]: aliasValue(
            THEME_COLLECTION_NAMES.theme,
            modeThemeColorVariableName(slot, THEME_MODE_NAMES.light),
          ),
          [THEME_MODE_NAMES.dark]: aliasValue(
            THEME_COLLECTION_NAMES.theme,
            modeThemeColorVariableName(slot, THEME_MODE_NAMES.dark),
          ),
        },
      }),
    );
  }

  return specs;
}

function createTailwindResolutionReport() {
  return {
    tailwindAliasResolved: 0,
    tailwindAliasByBlueprint: 0,
    tailwindAliasByRecipe: 0,
    tailwindAliasByHeuristic: 0,
    tailwindLiteralFallback: 0,
    tailwindMissingCollection: false,
  };
}

function countResolvableThemeModeValues(specs) {
  let count = 0;

  for (const spec of specs) {
    if (spec.collectionName !== THEME_COLLECTION_NAMES.theme) {
      continue;
    }

    for (const modeValue of Object.values(spec.valuesByModeName)) {
      if (modeValue?.kind === "VALUE") {
        count += 1;
      }
    }
  }

  return count;
}

function getCollectionDefaultModeName(collectionRecord) {
  if (!collectionRecord) {
    return THEME_MODE_NAMES.default;
  }

  if (collectionRecord.defaultModeName) {
    return collectionRecord.defaultModeName;
  }

  const defaultModeId = collectionRecord.collection?.defaultModeId;
  if (defaultModeId && collectionRecord.modesById?.[defaultModeId]?.name) {
    return collectionRecord.modesById[defaultModeId].name;
  }

  const modeNames = Object.keys(collectionRecord.modesByName ?? {});
  return modeNames[0] ?? THEME_MODE_NAMES.default;
}

function normalizeAllowedPrefix(prefix) {
  return prefix.toLowerCase();
}

function allowedTailwindPrefixesForSpec(spec) {
  if (spec.name.startsWith("colors/")) {
    return ["tailwind colors/"];
  }

  if (spec.name.startsWith("font/")) {
    return ["font/", "font-family/"];
  }

  if (spec.name.startsWith("radius/")) {
    return ["border-radius/"];
  }

  if (spec.name.startsWith("blur/")) {
    return ["blur/"];
  }

  if (spec.name.startsWith("shadow/")) {
    return ["shadow/", "box-shadow/"];
  }

  if (spec.name.startsWith("drop-shadow/")) {
    return ["drop-shadow/"];
  }

  if (spec.name.startsWith("inset-shadow/")) {
    return ["inset-shadow/"];
  }

  return [];
}

function tokenizeVariableName(value) {
  return String(value)
    .toLowerCase()
    .split(/[\/\-\s_.]+/)
    .filter(Boolean);
}

function countSharedTokens(leftTokens, rightTokens) {
  let count = 0;
  const rightSet = new Set(rightTokens);

  for (const token of new Set(leftTokens)) {
    if (rightSet.has(token)) {
      count += 1;
    }
  }

  return count;
}

function isSelfReferencingTailwindCandidate(spec, candidate) {
  return (
    candidate.modeValue?.kind === "ALIAS" &&
    candidate.modeValue.targetCollectionName === spec.collectionName &&
    candidate.modeValue.targetName === spec.name
  );
}

function buildTailwindCandidateIndex(registry) {
  const collectionRecord = registry.collections?.[TAILWIND_COLLECTION_NAME];
  if (!collectionRecord) {
    return null;
  }

  const defaultModeName = getCollectionDefaultModeName(collectionRecord);
  const list = [];
  const byName = new Map();

  for (const variableRecord of Object.values(collectionRecord.variablesByName ?? {})) {
    const modeValue =
      variableRecord.valuesByModeName?.[defaultModeName] ??
      Object.values(variableRecord.valuesByModeName ?? {}).find(Boolean);

    if (!modeValue || modeValue.kind === "ERROR") {
      continue;
    }

    const candidate = {
      name: variableRecord.name,
      type: variableRecord.resolvedType,
      scopes: [...(variableRecord.scopes ?? [])],
      modeValue,
      value: resolvedModeValue(modeValue),
    };

    list.push(candidate);
    byName.set(candidate.name, candidate);
  }

  return {
    collectionRecord,
    defaultModeName,
    list,
    byName,
  };
}

function candidateMatchesSpecValue(spec, expectedValue, candidate) {
  if (!candidate || candidate.type !== spec.type) {
    return false;
  }

  return compareScalarValues(spec, expectedValue, candidate.value);
}

function scoreTailwindCandidate(spec, candidate, allowedPrefixes, preferredTargetNames) {
  const normalizedName = candidate.name.toLowerCase();
  const candidateTokens = tokenizeVariableName(candidate.name);
  const specTokens = tokenizeVariableName(spec.name);
  let score = 0;

  const prefixIndex = allowedPrefixes.findIndex((prefix) => normalizedName.startsWith(normalizeAllowedPrefix(prefix)));
  if (prefixIndex !== -1) {
    score += 200 - prefixIndex * 10;
  }

  score += countSharedTokens(candidateTokens, specTokens) * 25;

  for (const scaleToken of specTokens) {
    if (SCALE_TOKENS.has(scaleToken) && candidateTokens.includes(scaleToken)) {
      score += 90;
    }
  }

  const semanticSuffix = specTokens[specTokens.length - 1];
  if (semanticSuffix && candidateTokens.includes(semanticSuffix)) {
    score += 30;
  }

  preferredTargetNames.forEach((targetName, index) => {
    const normalizedTargetName = targetName.toLowerCase();
    if (normalizedName === normalizedTargetName) {
      score += 1000 - index * 100;
    }

    score += countSharedTokens(candidateTokens, tokenizeVariableName(targetName)) * 40;
  });

  return score;
}

function findDirectTailwindAliasTarget(spec, expectedValue, targetName, tailwindIndex) {
  if (!targetName) {
    return null;
  }

  const candidate = tailwindIndex.byName.get(targetName);
  if (!candidate || isSelfReferencingTailwindCandidate(spec, candidate)) {
    return null;
  }

  if (!candidateMatchesSpecValue(spec, expectedValue, candidate)) {
    return null;
  }

  return candidate;
}

function findHeuristicTailwindAliasTarget(spec, expectedValue, allowedPrefixes, preferredTargetNames, tailwindIndex) {
  const candidates = tailwindIndex.list.filter((candidate) => {
    const normalizedName = candidate.name.toLowerCase();
    if (!allowedPrefixes.some((prefix) => normalizedName.startsWith(normalizeAllowedPrefix(prefix)))) {
      return false;
    }

    if (isSelfReferencingTailwindCandidate(spec, candidate)) {
      return false;
    }

    return candidateMatchesSpecValue(spec, expectedValue, candidate);
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const scoreDelta =
      scoreTailwindCandidate(spec, right, allowedPrefixes, preferredTargetNames) -
      scoreTailwindCandidate(spec, left, allowedPrefixes, preferredTargetNames);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.name.localeCompare(right.name);
  });

  return candidates[0];
}

function resolveThemeModeValueToTailwindAlias(spec, expectedModeValue, tailwindIndex) {
  const blueprintTargetName = THEME_BLUEPRINT_TAILWIND_ALIAS_MAP[spec.name];
  const recipeTargetName = THEME_TAILWIND_ALIAS_RECIPES[spec.name];
  const preferredTargetNames = [blueprintTargetName, recipeTargetName].filter(Boolean);
  const directBlueprintMatch = findDirectTailwindAliasTarget(spec, expectedModeValue.value, blueprintTargetName, tailwindIndex);
  if (directBlueprintMatch) {
    return {
      method: "blueprint",
      targetName: directBlueprintMatch.name,
    };
  }

  const directRecipeMatch = findDirectTailwindAliasTarget(spec, expectedModeValue.value, recipeTargetName, tailwindIndex);
  if (directRecipeMatch) {
    return {
      method: "recipe",
      targetName: directRecipeMatch.name,
    };
  }

  const allowedPrefixes = allowedTailwindPrefixesForSpec(spec);
  if (allowedPrefixes.length === 0) {
    return null;
  }

  const heuristicMatch = findHeuristicTailwindAliasTarget(
    spec,
    expectedModeValue.value,
    allowedPrefixes,
    preferredTargetNames,
    tailwindIndex,
  );
  if (!heuristicMatch) {
    return null;
  }

  return {
    method: "heuristic",
    targetName: heuristicMatch.name,
  };
}

export function resolveThemeVariableSpecsToTailwindAliases(specs, registry) {
  const resolvedSpecs = deepClone(specs);
  const resolutionReport = createTailwindResolutionReport();
  const tailwindIndex = buildTailwindCandidateIndex(registry);

  if (!tailwindIndex) {
    resolutionReport.tailwindMissingCollection = true;
    resolutionReport.tailwindLiteralFallback = countResolvableThemeModeValues(specs);
    return {
      resolvedSpecs,
      resolutionReport,
    };
  }

  for (const spec of resolvedSpecs) {
    if (spec.collectionName !== THEME_COLLECTION_NAMES.theme) {
      continue;
    }

    for (const [modeName, expectedModeValue] of Object.entries(spec.valuesByModeName)) {
      if (expectedModeValue?.kind !== "VALUE") {
        continue;
      }

      const resolution = resolveThemeModeValueToTailwindAlias(spec, expectedModeValue, tailwindIndex);
      if (!resolution) {
        resolutionReport.tailwindLiteralFallback += 1;
        continue;
      }

      spec.valuesByModeName[modeName] = aliasValue(TAILWIND_COLLECTION_NAME, resolution.targetName);
      resolutionReport.tailwindAliasResolved += 1;
      if (resolution.method === "blueprint") {
        resolutionReport.tailwindAliasByBlueprint += 1;
      } else if (resolution.method === "recipe") {
        resolutionReport.tailwindAliasByRecipe += 1;
      } else {
        resolutionReport.tailwindAliasByHeuristic += 1;
      }
    }
  }

  return {
    resolvedSpecs,
    resolutionReport,
  };
}

export function applyRegistryToThemeContract(baseContract, registry) {
  const contract = cloneThemeContract(baseContract);

  for (const slot of THEME_SCHEMA.colorSlots) {
    const lightValue = readThemeModeValue(registry, colorVariableName(slot, "light"), THEME_MODE_NAMES.default);
    const normalizedLight = normalizeColor(lightValue);
    if (normalizedLight) {
      contract.colors[slot].light = normalizedLight;
    }

    const darkValue = readThemeModeValue(registry, colorVariableName(slot, "dark"), THEME_MODE_NAMES.default);
    const normalizedDark = normalizeColor(darkValue);
    if (normalizedDark) {
      contract.colors[slot].dark = normalizedDark;
    }
  }

  for (const fontKey of FONT_KEYS) {
    const value = readThemeModeValue(registry, fontVariableName(fontKey), THEME_MODE_NAMES.default);
    if (typeof value === "string" && value) {
      contract.fonts[fontKey] = value;
    }
  }

  for (const radiusKey of RADIUS_KEYS) {
    const value = readThemeModeValue(registry, radiusVariableName(radiusKey), THEME_MODE_NAMES.default);
    if (Number.isFinite(value)) {
      contract.radius[radiusKey] = value;
    }
  }

  for (const [groupKey, group] of Object.entries(EFFECT_GROUPS)) {
    for (const scale of group.scales) {
      const layerCount = group.layers[scale];
      const layers = [];
      for (let layerIndex = 0; layerIndex < layerCount; layerIndex += 1) {
        const specLayerIndex = layerCount > 1 ? layerIndex + 1 : null;
        const offsetX = readThemeModeValue(
          registry,
          effectVariableName(groupKey, scale, "offsetX", specLayerIndex),
          THEME_MODE_NAMES.default,
        );
        const offsetY = readThemeModeValue(
          registry,
          effectVariableName(groupKey, scale, "offsetY", specLayerIndex),
          THEME_MODE_NAMES.default,
        );
        const blur = readThemeModeValue(
          registry,
          effectVariableName(groupKey, scale, "blur", specLayerIndex),
          THEME_MODE_NAMES.default,
        );
        const spread = readThemeModeValue(
          registry,
          effectVariableName(groupKey, scale, "spread", specLayerIndex),
          THEME_MODE_NAMES.default,
        );
        const color = readThemeModeValue(
          registry,
          effectVariableName(groupKey, scale, "color", specLayerIndex),
          THEME_MODE_NAMES.default,
        );

        const normalizedColor = normalizeColor(color);
        if ([offsetX, offsetY, blur, spread].every((value) => Number.isFinite(value)) && normalizedColor) {
          const layer = {
            offsetX,
            offsetY,
            blur,
            spread,
            color: normalizedColor,
          };
          if (groupKey === "insetShadow") {
            layer.inset = true;
          }
          layers.push(layer);
        }
      }

      if (layers.length > 0) {
        contract.effects[groupKey][scale] = layers;
      }
    }
  }

  for (const scale of BLUR_SCALES) {
    const value = readThemeModeValue(registry, blurVariableName(scale), THEME_MODE_NAMES.default);
    if (Number.isFinite(value)) {
      contract.effects.blur[scale] = value;
    }
  }

  return contract;
}

export function diffThemeVariableSpecs(specs, registry) {
  const report = {
    create: 0,
    update: 0,
    noOp: 0,
    conflict: 0,
    byCollection: {},
    conflicts: [],
    missingCollections: [],
    missingModes: [],
    aliasFailures: [],
  };

  const seenMissingCollections = new Set();
  const seenMissingModes = new Set();

  for (const spec of specs) {
    const collection = registry.collections[spec.collectionName];
    if (!collection) {
      pushCollectionCount(report, spec.collectionName, "create");
      if (!seenMissingCollections.has(spec.collectionName)) {
        seenMissingCollections.add(spec.collectionName);
        report.missingCollections.push(spec.collectionName);
      }
      continue;
    }

    const missingModes = Object.keys(spec.valuesByModeName).filter((modeName) => !collection.modesByName?.[modeName]);
    if (missingModes.length > 0) {
      pushCollectionCount(report, spec.collectionName, "create");
      for (const modeName of missingModes) {
        const key = `${spec.collectionName}:${modeName}`;
        if (!seenMissingModes.has(key)) {
          seenMissingModes.add(key);
          report.missingModes.push({ collectionName: spec.collectionName, modeName });
        }
      }
      continue;
    }

    const variable = collection.variablesByName?.[spec.name];
    if (!variable) {
      pushCollectionCount(report, spec.collectionName, "create");
      continue;
    }

    if (variable.resolvedType !== spec.type) {
      pushCollectionCount(report, spec.collectionName, "conflict");
      report.conflicts.push({
        collectionName: spec.collectionName,
        name: spec.name,
        expectedType: spec.type,
        actualType: variable.resolvedType,
      });
      continue;
    }

    const needsUpdate = Object.entries(spec.valuesByModeName).some(([modeName, expected]) => {
      const actual = variable.valuesByModeName?.[modeName];
      if (!actual) {
        return true;
      }

      if (expected.kind === "ALIAS") {
        return !(
          actual.kind === "ALIAS" &&
          actual.targetCollectionName === expected.targetCollectionName &&
          actual.targetName === expected.targetName
        );
      }

      if (actual.kind === "ALIAS") {
        return true;
      }

      return !compareScalarValues(spec, resolvedModeValue(actual), expected.value);
    });

    if (needsUpdate) {
      pushCollectionCount(report, spec.collectionName, "update");
    } else {
      pushCollectionCount(report, spec.collectionName, "noOp");
    }
  }

  return report;
}
