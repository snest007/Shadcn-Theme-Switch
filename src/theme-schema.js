import { MODE_BASE_SLOTS, THEME_COLOR_SLOTS } from "./constants.js";

export const THEME_CONTRACT_VERSION = 1;

export const THEME_COLLECTION_NAMES = {
  theme: "2. Theme",
  mode: "3. Mode",
};

export const THEME_MODE_NAMES = {
  default: "Default",
  light: "Light",
  dark: "Dark",
};

export const THEME_COLOR_MODES = ["light", "dark"];

export const FONT_KEYS = ["sans", "serif", "mono"];

export const FONT_TOKEN_KEYS = {
  sans: "font-sans",
  serif: "font-serif",
  mono: "font-mono",
};

export const FONT_VARIABLE_SCOPES = ["FONT_FAMILY"];

export const RADIUS_KEYS = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];

export const NUMBER_VARIABLE_SCOPES = [];

export const COLOR_VARIABLE_SCOPES = ["ALL_SCOPES"];

export const EFFECT_FLOAT_SCOPES = ["EFFECT_FLOAT"];

export const EFFECT_COLOR_SCOPES = ["EFFECT_COLOR"];

export const EFFECT_LAYER_PROPERTY_KEYS = {
  offsetX: "offset-x",
  offsetY: "offset-y",
  blur: "blur-radius",
  spread: "spread-radius",
  color: "color",
};

export const EFFECT_GROUPS = {
  shadow: {
    tokenPath: "shadow",
    variablePath: "shadow",
    scales: ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"],
    layers: {
      "2xs": 1,
      xs: 1,
      sm: 2,
      md: 2,
      lg: 2,
      xl: 2,
      "2xl": 1,
    },
  },
  dropShadow: {
    tokenPath: "drop-shadow",
    variablePath: "drop-shadow",
    scales: ["xs", "sm", "md", "lg", "xl", "2xl"],
    layers: {
      xs: 1,
      sm: 1,
      md: 1,
      lg: 1,
      xl: 1,
      "2xl": 1,
    },
  },
  insetShadow: {
    tokenPath: "inset-shadow",
    variablePath: "inset-shadow",
    scales: ["2xs", "xs", "sm"],
    layers: {
      "2xs": 1,
      xs: 1,
      sm: 1,
    },
  },
};

export const BLUR_SCALES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"];

export const EXPECTED_THEME_VARIABLE_COUNTS = {
  theme: 235,
  mode: 78,
};

export function colorVariableName(slot, modeName) {
  return `colors/${slot}-${modeName}`;
}

export function fontVariableName(fontKey) {
  return `font/${FONT_TOKEN_KEYS[fontKey]}`;
}

export function radiusVariableName(radiusKey) {
  return `radius/${radiusKey}`;
}

export function blurVariableName(scale) {
  return `blur/${scale}`;
}

export function effectVariableName(groupKey, scale, propertyKey, layerIndex = null) {
  const propertyName = EFFECT_LAYER_PROPERTY_KEYS[propertyKey];
  const group = EFFECT_GROUPS[groupKey];
  if (!group) {
    throw new Error(`Unsupported effect group "${groupKey}".`);
  }

  if (layerIndex === null) {
    return `${group.variablePath}/${scale}/${propertyName}`;
  }

  return `${group.variablePath}/${scale}/${layerIndex}/${propertyName}`;
}

export function modeBaseVariableName(slot) {
  return `base/${slot}`;
}

export function themeModeSuffix(modeName) {
  return modeName.toLowerCase();
}

export function modeThemeColorVariableName(slot, modeName) {
  return colorVariableName(slot === "ring-offset" ? "background" : slot, themeModeSuffix(modeName));
}

export const THEME_SCHEMA = {
  colorSlots: THEME_COLOR_SLOTS,
  modeBaseSlots: MODE_BASE_SLOTS,
};
