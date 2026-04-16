import { parseThemeCssText, renderThemeCss } from "../../src/theme-css.js";
import { toFigmaColor } from "../../src/color.js";
import { extractPrimaryFontFamily } from "../../src/font-family.js";
import {
  applyRegistryToThemeContract,
  buildThemeVariableSpecs,
  diffThemeVariableSpecs,
  resolveThemeVariableSpecsToTailwindAliases,
} from "../../src/theme-figma.js";
import { buildThemePayload, encodeThemePayload } from "../../src/theme-payload.js";
import { THEME_COLLECTION_NAMES, THEME_MODE_NAMES } from "../../src/theme-schema.js";
import { defaultThemeContract } from "../../src/theme-default-contract.generated.js";

const UI_SIZE = {
  width: 454,
  height: 653,
};

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function formatImportThemeModeBaseName(date = new Date()) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hour = padNumber(date.getHours());
  const minute = padNumber(date.getMinutes());
  return `Imported ${year}-${month}-${day} ${hour}:${minute}`;
}

function stripGeneratedImportModeSuffix(value) {
  return String(value).replace(/ \(\d+\)$/u, "");
}

function resolveImportThemeModeName(registry, requestedName = null) {
  const baseName = stripGeneratedImportModeSuffix(requestedName ?? formatImportThemeModeBaseName());
  const themeCollection = registry.collections[THEME_COLLECTION_NAMES.theme];
  const existingModeNames = new Set(Object.keys(themeCollection?.modesByName ?? {}));

  if (!existingModeNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (existingModeNames.has(`${baseName} (${suffix})`)) {
    suffix += 1;
  }

  return `${baseName} (${suffix})`;
}

function postToUi(type, payload = {}) {
  figma.ui.postMessage({
    type,
    ...payload,
  });
}

function reportError(error) {
  const message = error instanceof Error ? error.message : String(error);
  figma.notify(message, { error: true });
  postToUi("variables:error", {
    message,
  });
}

function isAliasValue(value) {
  return Boolean(value) && typeof value === "object" && value.type === "VARIABLE_ALIAS";
}

const loadedFontNames = new Set();
let availableFontsPromise = null;

async function listAvailableFonts() {
  if (!availableFontsPromise) {
    availableFontsPromise = figma.listAvailableFontsAsync();
  }
  return availableFontsPromise;
}

async function ensureFontFamilyLoaded(fontFamily) {
  const availableFonts = await listAvailableFonts();
  const matchingFonts = availableFonts.filter((entry) => entry.fontName.family === fontFamily);
  if (matchingFonts.length === 0) {
    throw new Error(
      `Font family "${fontFamily}" is not available in Figma. Import currently writes FONT_FAMILY variables using the primary family from the CSS stack.`,
    );
  }

  for (const entry of matchingFonts) {
    const key = `${entry.fontName.family}::${entry.fontName.style}`;
    if (loadedFontNames.has(key)) {
      continue;
    }

    await figma.loadFontAsync(entry.fontName);
    loadedFontNames.add(key);
  }
}

async function normalizeValueForWrite(spec, value) {
  if (spec.type === "COLOR") {
    return toFigmaColor(value);
  }

  if (spec.type === "STRING" && Array.isArray(spec.scopes) && spec.scopes.includes("FONT_FAMILY")) {
    const primaryFamily = extractPrimaryFontFamily(value);
    if (!primaryFamily) {
      return value;
    }

    await ensureFontFamilyLoaded(primaryFamily);
    return primaryFamily;
  }

  return value;
}

function pickModeForCollection(collectionRecord, requestedModeName) {
  if (!collectionRecord) {
    return null;
  }

  return (
    collectionRecord.modesByName[requestedModeName] ??
    collectionRecord.modesById[collectionRecord.collection.defaultModeId] ??
    Object.values(collectionRecord.modesByName)[0] ??
    null
  );
}

function resolveVariableModeValue(variableHandle, modeName, registry, seen = new Set()) {
  const collectionRecord = registry.collectionsById.get(variableHandle.variableCollectionId);
  const modeRecord = pickModeForCollection(collectionRecord, modeName);
  if (!modeRecord) {
    return null;
  }

  const traceKey = `${variableHandle.id}:${modeRecord.name}`;
  if (seen.has(traceKey)) {
    return {
      kind: "ERROR",
      message: `Circular alias detected for ${variableHandle.name}`,
    };
  }

  seen.add(traceKey);
  const rawValue = variableHandle.valuesByMode?.[modeRecord.modeId];
  if (isAliasValue(rawValue)) {
    const targetVariableRecord = registry.variablesById.get(rawValue.id);
    if (!targetVariableRecord) {
      return {
        kind: "ALIAS",
        targetVariableId: rawValue.id,
        targetCollectionName: null,
        targetName: null,
        resolutionError: `Missing alias target ${rawValue.id}`,
      };
    }

    const targetCollectionRecord = registry.collectionsById.get(targetVariableRecord.variable.variableCollectionId);
    const nextModeName = targetCollectionRecord?.modesByName[modeName] ? modeName : pickModeForCollection(targetCollectionRecord, modeName)?.name;
    const resolvedTarget = resolveVariableModeValue(targetVariableRecord.variable, nextModeName, registry, seen);
    return {
      kind: "ALIAS",
      targetVariableId: rawValue.id,
      targetCollectionName: targetCollectionRecord?.name ?? null,
      targetName: targetVariableRecord.variable.name,
      resolvedValue: resolvedTarget?.resolvedValue ?? resolvedTarget?.value,
      resolutionError: resolvedTarget?.kind === "ERROR" ? resolvedTarget.message : null,
    };
  }

  return {
    kind: "VALUE",
    value: rawValue,
    resolvedValue: rawValue,
  };
}

async function readRegistry() {
  const collectionHandles = await figma.variables.getLocalVariableCollectionsAsync();
  const variableHandles = await figma.variables.getLocalVariablesAsync();

  const registry = {
    collections: {},
    collectionsById: new Map(),
    variablesById: new Map(),
  };

  for (const collection of collectionHandles) {
    const record = {
      name: collection.name,
      collection,
      defaultModeName: collection.modes.find((mode) => mode.modeId === collection.defaultModeId)?.name ?? collection.modes[0]?.name ?? null,
      modesByName: {},
      modesById: {},
      variablesByName: {},
    };

    for (const mode of collection.modes) {
      const modeRecord = {
        name: mode.name,
        modeId: mode.modeId,
      };
      record.modesByName[mode.name] = modeRecord;
      record.modesById[mode.modeId] = modeRecord;
    }

    registry.collections[collection.name] = record;
    registry.collectionsById.set(collection.id, record);
  }

  for (const variable of variableHandles) {
    const collectionRecord = registry.collectionsById.get(variable.variableCollectionId);
    if (!collectionRecord) {
      continue;
    }

    const record = {
      variable,
      name: variable.name,
      resolvedType: variable.resolvedType,
      scopes: [...(variable.scopes ?? [])],
      description: variable.description ?? "",
      valuesByModeName: {},
    };

    collectionRecord.variablesByName[variable.name] = record;
    registry.variablesById.set(variable.id, record);
  }

  for (const collectionRecord of Object.values(registry.collections)) {
    for (const variableRecord of Object.values(collectionRecord.variablesByName)) {
      for (const modeRecord of Object.values(collectionRecord.modesByName)) {
        variableRecord.valuesByModeName[modeRecord.name] = resolveVariableModeValue(
          variableRecord.variable,
          modeRecord.name,
          registry,
        );
      }
    }
  }

  return registry;
}

async function ensureCollection(name, desiredModeNames, registry, { renameSingleModeOnCreateOnly = false } = {}) {
  let collectionRecord = registry.collections[name];
  let collectionWasCreated = false;
  if (!collectionRecord) {
    figma.variables.createVariableCollection(name);
    registry = await readRegistry();
    collectionRecord = registry.collections[name];
    collectionWasCreated = true;
  }

  if (!collectionRecord) {
    throw new Error(`Failed to create collection "${name}".`);
  }

  for (let index = 0; index < desiredModeNames.length; index += 1) {
    const desiredModeName = desiredModeNames[index];
    if (collectionRecord.modesByName[desiredModeName]) {
      continue;
    }

    const existingModes = Object.values(collectionRecord.modesByName);
    if (existingModes.length === 1 && (!renameSingleModeOnCreateOnly || collectionWasCreated)) {
      collectionRecord.collection.renameMode(existingModes[0].modeId, desiredModeName);
    } else {
      collectionRecord.collection.addMode(desiredModeName);
    }

    registry = await readRegistry();
    collectionRecord = registry.collections[name];
  }

  return registry;
}

async function ensureCollectionsAndModes(registry, { themeModeName = THEME_MODE_NAMES.default } = {}) {
  registry = await ensureCollection(THEME_COLLECTION_NAMES.theme, [themeModeName], registry, {
    renameSingleModeOnCreateOnly: true,
  });
  registry = await ensureCollection(THEME_COLLECTION_NAMES.mode, [THEME_MODE_NAMES.light, THEME_MODE_NAMES.dark], registry);
  return registry;
}

async function ensureVariablesForSpecs(specs, registry) {
  for (const spec of specs) {
    const collectionRecord = registry.collections[spec.collectionName];
    if (!collectionRecord) {
      throw new Error(`Missing collection "${spec.collectionName}" during ensureVariablesForSpecs.`);
    }

    const existing = collectionRecord.variablesByName[spec.name];
    if (existing) {
      if (existing.resolvedType !== spec.type) {
        throw new Error(
          `Type conflict for ${spec.collectionName}/${spec.name}: expected ${spec.type}, found ${existing.resolvedType}.`,
        );
      }
      continue;
    }

    const createdVariable = figma.variables.createVariable(spec.name, collectionRecord.collection, spec.type);
    if (Array.isArray(spec.scopes) && spec.scopes.length > 0) {
      createdVariable.scopes = [...spec.scopes];
    }
    registry = await readRegistry();
  }

  return registry;
}

function modeValueMatches(expected, actual) {
  if (!actual) {
    return false;
  }

  if (expected.kind === "ALIAS") {
    return (
      actual.kind === "ALIAS" &&
      actual.targetCollectionName === expected.targetCollectionName &&
      actual.targetName === expected.targetName
    );
  }

  if (actual.kind === "ALIAS") {
    return false;
  }

  return true;
}

async function applySpecsToRegistry(specs, registry) {
  for (const spec of specs) {
    const collectionRecord = registry.collections[spec.collectionName];
    const variableRecord = collectionRecord?.variablesByName?.[spec.name];
    if (!collectionRecord || !variableRecord) {
      throw new Error(`Missing variable ${spec.collectionName}/${spec.name} while applying values.`);
    }

    if (Array.isArray(spec.scopes) && spec.scopes.length > 0) {
      variableRecord.variable.scopes = [...spec.scopes];
    }

    for (const [modeName, expectedModeValue] of Object.entries(spec.valuesByModeName)) {
      const modeRecord = collectionRecord.modesByName[modeName];
      if (!modeRecord) {
        throw new Error(`Missing mode "${modeName}" in collection "${spec.collectionName}".`);
      }

      if (expectedModeValue.kind === "ALIAS") {
        const targetCollection = registry.collections[expectedModeValue.targetCollectionName];
        const targetVariableRecord = targetCollection?.variablesByName?.[expectedModeValue.targetName];
        if (!targetVariableRecord) {
          throw new Error(
            `Missing alias target ${expectedModeValue.targetCollectionName}/${expectedModeValue.targetName}.`,
          );
        }

        const currentModeValue = variableRecord.valuesByModeName[modeName];
        if (!modeValueMatches(expectedModeValue, currentModeValue)) {
          variableRecord.variable.setValueForMode(
            modeRecord.modeId,
            figma.variables.createVariableAlias(targetVariableRecord.variable),
          );
        }
        continue;
      }

      const nextValue = await normalizeValueForWrite(spec, expectedModeValue.value);
      variableRecord.variable.setValueForMode(modeRecord.modeId, nextValue);
    }
  }
}

function commandFromPayload(payload) {
  return `npx shadcn-preset-figma theme apply --project . --payload ${payload}`;
}

function summarizeRegistry(registry) {
  const summary = {};

  for (const [collectionName, record] of Object.entries(registry.collections)) {
    summary[collectionName] = {
      modeNames: Object.keys(record.modesByName),
      variableCount: Object.keys(record.variablesByName).length,
    };
  }

  return summary;
}

function resolveImportSpecs(contract, registry, { themeModeName = THEME_MODE_NAMES.default } = {}) {
  const baseSpecs = buildThemeVariableSpecs(contract, { themeModeName });
  const { resolvedSpecs, resolutionReport } = resolveThemeVariableSpecsToTailwindAliases(baseSpecs, registry);
  return {
    specs: resolvedSpecs,
    resolutionReport,
    preflight: diffThemeVariableSpecs(resolvedSpecs, registry),
  };
}

async function buildExportState() {
  const registry = await readRegistry();
  const contract = applyRegistryToThemeContract(defaultThemeContract, registry);
  const { preflight } = resolveImportSpecs(contract, registry);
  const payload = encodeThemePayload(buildThemePayload(contract));

  return {
    registrySummary: summarizeRegistry(registry),
    contract,
    css: renderThemeCss(contract),
    cliCommand: commandFromPayload(payload),
    payload,
    preflight,
  };
}

async function analyzeImport(cssText) {
  const registry = await readRegistry();
  const themeModeName = resolveImportThemeModeName(registry);
  const currentContract = applyRegistryToThemeContract(defaultThemeContract, registry);
  const contract = parseThemeCssText(cssText, {
    baseContract: currentContract,
  });
  const { preflight, resolutionReport } = resolveImportSpecs(contract, registry, {
    themeModeName,
  });

  return {
    contract,
    css: renderThemeCss(contract),
    preflight,
    resolutionReport,
    themeModeName,
  };
}

async function applyImport(cssText, requestedThemeModeName = null) {
  let registry = await readRegistry();
  const themeModeName = resolveImportThemeModeName(registry, requestedThemeModeName);
  const currentContract = applyRegistryToThemeContract(defaultThemeContract, registry);
  const contract = parseThemeCssText(cssText, {
    baseContract: currentContract,
  });

  const { specs, preflight, resolutionReport } = resolveImportSpecs(contract, registry, {
    themeModeName,
  });
  if (preflight.conflict > 0) {
    throw new Error("Import aborted because type conflicts were detected in preflight.");
  }

  registry = await ensureCollectionsAndModes(registry, { themeModeName });
  const themeSpecs = specs.filter((spec) => spec.collectionName === THEME_COLLECTION_NAMES.theme);
  const modeSpecs = specs.filter((spec) => spec.collectionName === THEME_COLLECTION_NAMES.mode);

  registry = await ensureVariablesForSpecs(themeSpecs, registry);
  registry = await ensureVariablesForSpecs(modeSpecs, registry);
  registry = await readRegistry();

  await applySpecsToRegistry(themeSpecs, registry);
  registry = await readRegistry();
  await applySpecsToRegistry(modeSpecs, registry);
  registry = await readRegistry();

  return {
    css: renderThemeCss(contract),
    preflight: diffThemeVariableSpecs(specs, registry),
    resolutionReport,
    registrySummary: summarizeRegistry(registry),
    themeModeName,
  };
}

async function refreshState() {
  const exportState = await buildExportState();
  postToUi("variables:state", exportState);
}

figma.showUI(__html__, {
  width: UI_SIZE.width,
  height: UI_SIZE.height,
  themeColors: true,
});

figma.ui.onmessage = async (message) => {
  try {
    switch (message?.type) {
      case "variables:init":
      case "variables:refresh": {
        await refreshState();
        if (message?.type === "variables:refresh") {
          figma.notify("Theme state refreshed.");
        }
        break;
      }

      case "variables:analyzeImport": {
        const analysis = await analyzeImport(message.cssText ?? "");
        postToUi("variables:importAnalysis", analysis);
        figma.notify(`Import analysis ready for "${analysis.themeModeName}".`);
        break;
      }

      case "variables:applyImport": {
        const result = await applyImport(message.cssText ?? "", message.themeModeName ?? null);
        postToUi("variables:importApplied", result);
        figma.notify(`Figma variables synced to "${result.themeModeName}".`);
        await refreshState();
        break;
      }

      default:
        break;
    }
  } catch (error) {
    reportError(error);
  }
};

refreshState().catch((error) => {
  reportError(error);
});
