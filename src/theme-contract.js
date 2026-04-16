import { isColorObject, parseCssColor, sameColor } from "./color.js";
import { parseLengthToPx } from "./length.js";
import { resolveTokenValue } from "./token-tree.js";
import { parseBoxShadowCss } from "./theme-effects.js";
import {
  BLUR_SCALES,
  EFFECT_GROUPS,
  EFFECT_LAYER_PROPERTY_KEYS,
  FONT_KEYS,
  FONT_TOKEN_KEYS,
  RADIUS_KEYS,
  THEME_COLOR_MODES,
  THEME_SCHEMA,
} from "./theme-schema.js";
import { deepClone, fromEntries, getIn, isPlainObject, isTokenLeaf } from "./utils.js";

function buildEffectScaleMap(scales) {
  return fromEntries(scales.map((scale) => [scale, []]));
}

function copyTokenLeafWithValue(node, nextValue) {
  const result = {
    $type: node.$type,
    $value: nextValue,
  };

  if (node.$description) {
    result.$description = node.$description;
  }

  if (node.$extensions) {
    result.$extensions = deepClone(node.$extensions);
  }

  return result;
}

function isEffectLayerNode(node) {
  return (
    isPlainObject(node) &&
    ["offset-x", "offset-y", "blur-radius", "spread-radius", "color"].every(
      (property) => isTokenLeaf(node[property]),
    )
  );
}

function layerFromEffectNode(node, context) {
  return {
    offsetX: resolveTokenValue(node["offset-x"].$value, context),
    offsetY: resolveTokenValue(node["offset-y"].$value, context),
    blur: resolveTokenValue(node["blur-radius"].$value, context),
    spread: resolveTokenValue(node["spread-radius"].$value, context),
    color: resolveTokenValue(node.color.$value, context),
  };
}

function effectNodeToLayers(node, context) {
  if (!isPlainObject(node)) {
    return [];
  }

  if (isEffectLayerNode(node)) {
    return [layerFromEffectNode(node, context)];
  }

  return Object.keys(node)
    .filter((key) => !key.startsWith("$"))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => layerFromEffectNode(node[key], context));
}

function layerTemplateFromNode(node) {
  if (isEffectLayerNode(node)) {
    return node;
  }

  const candidateKey = Object.keys(node ?? {})
    .filter((key) => !key.startsWith("$"))
    .sort((left, right) => Number(left) - Number(right))[0];
  return candidateKey ? node[candidateKey] : null;
}

function buildEffectLayerTokens(templateNode, layer) {
  return {
    "offset-x": copyTokenLeafWithValue(templateNode["offset-x"], layer.offsetX),
    "offset-y": copyTokenLeafWithValue(templateNode["offset-y"], layer.offsetY),
    "blur-radius": copyTokenLeafWithValue(templateNode["blur-radius"], layer.blur),
    "spread-radius": copyTokenLeafWithValue(templateNode["spread-radius"], layer.spread),
    color: copyTokenLeafWithValue(templateNode.color, layer.color),
  };
}

function buildEffectTokenNode(templateNode, layers) {
  const layerTemplate = layerTemplateFromNode(templateNode);
  if (!layerTemplate) {
    return templateNode;
  }

  if (layers.length <= 1 && isEffectLayerNode(templateNode)) {
    return buildEffectLayerTokens(layerTemplate, layers[0] ?? {
      offsetX: 0,
      offsetY: 0,
      blur: 0,
      spread: 0,
      color: parseCssColor("#000000"),
    });
  }

  const result = {};
  const safeLayers = layers.length > 0 ? layers : [{
    offsetX: 0,
    offsetY: 0,
    blur: 0,
    spread: 0,
    color: parseCssColor("#000000"),
  }];
  safeLayers.forEach((layer, index) => {
    result[String(index + 1)] = buildEffectLayerTokens(layerTemplate, layer);
  });
  return result;
}

function maybeParseColor(value) {
  if (!value) {
    return null;
  }

  try {
    return parseCssColor(value);
  } catch {
    return null;
  }
}

function maybeParseLiteralString(value) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("var(")) {
    return null;
  }

  return trimmed;
}

function maybeParseLength(value, variables) {
  if (!value) {
    return null;
  }

  const pxValue = parseLengthToPx(value, variables);
  return Number.isFinite(pxValue) ? pxValue : null;
}

function maybeParseEffect(value, { forceInset = false } = {}) {
  if (!value) {
    return null;
  }

  try {
    return parseBoxShadowCss(value, { forceInset });
  } catch {
    return null;
  }
}

export function createEmptyThemeContract() {
  return {
    themeName: "default",
    colors: fromEntries(
      THEME_SCHEMA.colorSlots.map((slot) => [slot, { light: null, dark: null }]),
    ),
    fonts: fromEntries(FONT_KEYS.map((key) => [key, ""])),
    radius: fromEntries(RADIUS_KEYS.map((key) => [key, 0])),
    effects: {
      shadow: buildEffectScaleMap(EFFECT_GROUPS.shadow.scales),
      dropShadow: buildEffectScaleMap(EFFECT_GROUPS.dropShadow.scales),
      insetShadow: buildEffectScaleMap(EFFECT_GROUPS.insetShadow.scales),
      blur: fromEntries(BLUR_SCALES.map((scale) => [scale, 0])),
    },
  };
}

export function cloneThemeContract(contract) {
  return deepClone(contract);
}

export function themeTokenTreeToContract(themeTokens, context = themeTokens) {
  const contract = createEmptyThemeContract();

  for (const slot of THEME_SCHEMA.colorSlots) {
    for (const modeName of THEME_COLOR_MODES) {
      const node = getIn(themeTokens, ["colors", `${slot}-${modeName}`]);
      if (!isTokenLeaf(node)) {
        continue;
      }
      contract.colors[slot][modeName] = resolveTokenValue(node.$value, context);
    }
  }

  for (const fontKey of FONT_KEYS) {
    const node = getIn(themeTokens, ["font", FONT_TOKEN_KEYS[fontKey]]);
    if (!isTokenLeaf(node)) {
      continue;
    }
    contract.fonts[fontKey] = resolveTokenValue(node.$value, context);
  }

  for (const radiusKey of RADIUS_KEYS) {
    const node = getIn(themeTokens, ["radius", radiusKey]);
    if (!isTokenLeaf(node)) {
      continue;
    }
    contract.radius[radiusKey] = resolveTokenValue(node.$value, context);
  }

  for (const [groupKey, group] of Object.entries(EFFECT_GROUPS)) {
    for (const scale of group.scales) {
      const node = getIn(themeTokens, [group.tokenPath, scale]);
      if (!node) {
        continue;
      }
      contract.effects[groupKey][scale] = effectNodeToLayers(node, context).map((layer) =>
        groupKey === "insetShadow" ? { ...layer, inset: true } : layer,
      );
    }
  }

  for (const scale of BLUR_SCALES) {
    const node = getIn(themeTokens, ["blur", scale]);
    if (!isTokenLeaf(node)) {
      continue;
    }
    contract.effects.blur[scale] = resolveTokenValue(node.$value, context);
  }

  return contract;
}

export function applyThemeDeclarationsToContract(baseContract, declarations, { fonts = null } = {}) {
  const contract = cloneThemeContract(baseContract ?? createEmptyThemeContract());
  const root = declarations?.root ?? {};
  const dark = declarations?.dark ?? {};
  const themeInline = declarations?.themeInline ?? {};
  const combinedDeclarations = {
    ...root,
    ...themeInline,
  };

  for (const slot of THEME_SCHEMA.colorSlots) {
    const lightColor = maybeParseColor(root[`--${slot}`]);
    if (lightColor) {
      contract.colors[slot].light = lightColor;
    }

    const darkColor = maybeParseColor(dark[`--${slot}`]);
    if (darkColor) {
      contract.colors[slot].dark = darkColor;
    }
  }

  for (const fontKey of FONT_KEYS) {
    const cssVariable = `--${FONT_TOKEN_KEYS[fontKey]}`;
    const explicitFont =
      maybeParseLiteralString(themeInline[cssVariable]) ??
      maybeParseLiteralString(root[cssVariable]) ??
      maybeParseLiteralString(fonts?.[cssVariable]);
    if (explicitFont) {
      contract.fonts[fontKey] = explicitFont;
    }
  }

  const radiusDeclarations = {
    xs: themeInline["--radius-xs"],
    sm: themeInline["--radius-sm"],
    md: themeInline["--radius-md"],
    lg: themeInline["--radius-lg"] ?? root["--radius"],
    xl: themeInline["--radius-xl"],
    "2xl": themeInline["--radius-2xl"],
    "3xl": themeInline["--radius-3xl"],
    "4xl": themeInline["--radius-4xl"],
  };

  for (const radiusKey of RADIUS_KEYS) {
    const pxValue = maybeParseLength(radiusDeclarations[radiusKey], combinedDeclarations);
    if (pxValue !== null) {
      contract.radius[radiusKey] = pxValue;
    }
  }

  for (const [groupKey, group] of Object.entries(EFFECT_GROUPS)) {
    for (const scale of group.scales) {
      const cssValue = themeInline[`--${group.variablePath}-${scale}`] ?? root[`--${group.variablePath}-${scale}`];
      const layers = maybeParseEffect(cssValue, {
        forceInset: groupKey === "insetShadow",
      });
      if (layers) {
        contract.effects[groupKey][scale] = layers;
      }
    }
  }

  for (const scale of BLUR_SCALES) {
    const cssValue = themeInline[`--blur-${scale}`] ?? root[`--blur-${scale}`];
    const pxValue = maybeParseLength(cssValue, combinedDeclarations);
    if (pxValue !== null) {
      contract.effects.blur[scale] = pxValue;
    }
  }

  return contract;
}

function buildColorTokenValue(color, rawColorCandidates) {
  const exactCandidate = rawColorCandidates.find((candidate) => sameColor(candidate.color, color));
  if (exactCandidate) {
    return exactCandidate.ref;
  }
  return color;
}

export function applyThemeContractToThemeTokens(themeTokens, contract, { rawColorCandidates = [], onWrite = null } = {}) {
  for (const slot of THEME_SCHEMA.colorSlots) {
    for (const modeName of THEME_COLOR_MODES) {
      const color = contract.colors[slot][modeName];
      if (!isColorObject(color)) {
        continue;
      }
      const tokenPath = ["colors", `${slot}-${modeName}`];
      const templateNode = getIn(themeTokens, tokenPath);
      if (!isTokenLeaf(templateNode)) {
        continue;
      }
      getIn(themeTokens, ["colors"])[`${slot}-${modeName}`] = copyTokenLeafWithValue(
        templateNode,
        buildColorTokenValue(color, rawColorCandidates),
      );
      onWrite?.(tokenPath.join("."), {
        source: "theme-contract",
        detail: `${slot}.${modeName}`,
      });
    }
  }

  for (const fontKey of FONT_KEYS) {
    const tokenPath = ["font", FONT_TOKEN_KEYS[fontKey]];
    const templateNode = getIn(themeTokens, tokenPath);
    if (!isTokenLeaf(templateNode)) {
      continue;
    }
    getIn(themeTokens, ["font"])[FONT_TOKEN_KEYS[fontKey]] = copyTokenLeafWithValue(
      templateNode,
      contract.fonts[fontKey],
    );
    onWrite?.(tokenPath.join("."), {
      source: "theme-contract",
      detail: `fonts.${fontKey}`,
    });
  }

  for (const radiusKey of RADIUS_KEYS) {
    const tokenPath = ["radius", radiusKey];
    const templateNode = getIn(themeTokens, tokenPath);
    if (!isTokenLeaf(templateNode)) {
      continue;
    }
    getIn(themeTokens, ["radius"])[radiusKey] = copyTokenLeafWithValue(templateNode, contract.radius[radiusKey]);
    onWrite?.(tokenPath.join("."), {
      source: "theme-contract",
      detail: `radius.${radiusKey}`,
    });
  }

  for (const [groupKey, group] of Object.entries(EFFECT_GROUPS)) {
    for (const scale of group.scales) {
      const tokenPath = [group.tokenPath, scale];
      const templateNode = getIn(themeTokens, tokenPath);
      if (!templateNode) {
        continue;
      }
      getIn(themeTokens, [group.tokenPath])[scale] = buildEffectTokenNode(templateNode, contract.effects[groupKey][scale]);

      const layers = contract.effects[groupKey][scale];
      const pathStyle = group.tokenPath;
      if (layers.length <= 1) {
        for (const propertyKey of Object.keys(EFFECT_LAYER_PROPERTY_KEYS)) {
          onWrite?.([pathStyle, scale, EFFECT_LAYER_PROPERTY_KEYS[propertyKey]].join("."), {
            source: "theme-contract",
            detail: `${groupKey}.${scale}.${propertyKey}`,
          });
        }
        continue;
      }

      layers.forEach((_, index) => {
        for (const propertyKey of Object.keys(EFFECT_LAYER_PROPERTY_KEYS)) {
          onWrite?.([pathStyle, scale, String(index + 1), EFFECT_LAYER_PROPERTY_KEYS[propertyKey]].join("."), {
            source: "theme-contract",
            detail: `${groupKey}.${scale}.${index + 1}.${propertyKey}`,
          });
        }
      });
    }
  }

  for (const scale of BLUR_SCALES) {
    const tokenPath = ["blur", scale];
    const templateNode = getIn(themeTokens, tokenPath);
    if (!isTokenLeaf(templateNode)) {
      continue;
    }
    getIn(themeTokens, ["blur"])[scale] = copyTokenLeafWithValue(templateNode, contract.effects.blur[scale]);
    onWrite?.(tokenPath.join("."), {
      source: "theme-contract",
      detail: `blur.${scale}`,
    });
  }
}
