import { MANAGED_THEME_BLOCK } from "./constants.js";
import { serializeCssColor } from "./color.js";
import { extractBlock, findManagedBlockRange, parseDeclarations } from "./css-blocks.js";
import { serializeLengthPx } from "./length.js";
import { applyThemeDeclarationsToContract, createEmptyThemeContract } from "./theme-contract.js";
import {
  BLUR_SCALES,
  EFFECT_GROUPS,
  FONT_KEYS,
  FONT_TOKEN_KEYS,
  RADIUS_KEYS,
  THEME_SCHEMA,
} from "./theme-schema.js";
import { serializeBoxShadow } from "./theme-effects.js";

function renderBlock(selector, declarations) {
  const body = declarations.map((line) => `  ${line}`).join("\n");
  return `${selector} {\n${body}\n}`;
}

function renderRootDeclarations(contract) {
  const declarations = [];
  for (const slot of THEME_SCHEMA.colorSlots) {
    declarations.push(`--${slot}: ${serializeCssColor(contract.colors[slot].light)};`);
  }
  declarations.push(`--radius: ${serializeLengthPx(contract.radius.lg)};`);
  return declarations;
}

function renderDarkDeclarations(contract) {
  const declarations = [];
  for (const slot of THEME_SCHEMA.colorSlots) {
    declarations.push(`--${slot}: ${serializeCssColor(contract.colors[slot].dark)};`);
  }
  return declarations;
}

function renderThemeInlineDeclarations(contract) {
  const declarations = [];

  for (const fontKey of FONT_KEYS) {
    declarations.push(`--${FONT_TOKEN_KEYS[fontKey]}: ${contract.fonts[fontKey]};`);
  }

  for (const slot of THEME_SCHEMA.colorSlots) {
    declarations.push(`--color-${slot}: var(--${slot});`);
  }

  for (const radiusKey of RADIUS_KEYS) {
    const value = radiusKey === "lg" ? "var(--radius)" : serializeLengthPx(contract.radius[radiusKey]);
    declarations.push(`--radius-${radiusKey}: ${value};`);
  }

  for (const [groupKey, group] of Object.entries(EFFECT_GROUPS)) {
    for (const scale of group.scales) {
      declarations.push(
        `--${group.variablePath}-${scale}: ${serializeBoxShadow(contract.effects[groupKey][scale], {
          inset: groupKey === "insetShadow",
        })};`,
      );
    }
  }

  for (const scale of BLUR_SCALES) {
    declarations.push(`--blur-${scale}: ${serializeLengthPx(contract.effects.blur[scale])};`);
  }

  return declarations;
}

export function extractThemeDeclarations(cssText) {
  const managedRange = findManagedBlockRange(cssText, MANAGED_THEME_BLOCK.start, MANAGED_THEME_BLOCK.end);
  const source = managedRange ? managedRange.content : cssText;

  return {
    root: parseDeclarations(extractBlock(source, /:root\s*\{/g)),
    dark: parseDeclarations(extractBlock(source, /\.dark\s*\{/g)),
    themeInline: parseDeclarations(extractBlock(source, /@theme\s+inline\s*\{/g)),
  };
}

export function parseThemeCssText(cssText, { baseContract = null } = {}) {
  return applyThemeDeclarationsToContract(baseContract ?? createEmptyThemeContract(), extractThemeDeclarations(cssText));
}

export function renderThemeCss(contract, { includeManagedBlock = true } = {}) {
  const sections = [
    renderBlock(":root", renderRootDeclarations(contract)),
    renderBlock(".dark", renderDarkDeclarations(contract)),
    renderBlock("@theme inline", renderThemeInlineDeclarations(contract)),
  ];

  const content = sections.join("\n\n");
  if (!includeManagedBlock) {
    return `${content}\n`;
  }

  return `${MANAGED_THEME_BLOCK.start}\n${content}\n${MANAGED_THEME_BLOCK.end}\n`;
}
