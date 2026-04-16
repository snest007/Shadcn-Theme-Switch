import { MANAGED_THEME_BLOCK } from "./constants.js";
import { extractBlockRange, findManagedBlockRange } from "./css-blocks.js";

function replaceRange(text, range, replacement) {
  return `${text.slice(0, range.start)}${replacement}${text.slice(range.end)}`;
}

function normalizeSpacing(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function findLegacyThemeSection(cssText) {
  const ranges = [
    extractBlockRange(cssText, /@theme\s+inline\s*\{/g),
    extractBlockRange(cssText, /:root\s*\{/g),
    extractBlockRange(cssText, /\.dark\s*\{/g),
  ].filter(Boolean);

  if (ranges.length === 0) {
    return null;
  }

  return {
    start: Math.min(...ranges.map((range) => range.start)),
    end: Math.max(...ranges.map((range) => range.end)),
  };
}

function findPreferredInsertIndex(cssText) {
  const layerIndex = cssText.search(/@layer\s+base\b/);
  if (layerIndex !== -1) {
    return layerIndex;
  }

  return cssText.length;
}

export function upsertManagedThemeBlock(cssText, renderedThemeCss) {
  const managedRange = findManagedBlockRange(cssText, MANAGED_THEME_BLOCK.start, MANAGED_THEME_BLOCK.end);
  const normalizedBlock = normalizeSpacing(renderedThemeCss);
  if (managedRange) {
    return replaceRange(cssText, managedRange, normalizedBlock.trimEnd());
  }

  const legacyRange = findLegacyThemeSection(cssText);
  if (legacyRange) {
    return replaceRange(cssText, legacyRange, normalizedBlock.trimEnd());
  }

  const insertIndex = findPreferredInsertIndex(cssText);
  const prefix = insertIndex === 0 || cssText.slice(0, insertIndex).endsWith("\n\n") ? "" : "\n\n";
  const suffix = cssText.slice(insertIndex).startsWith("\n") ? "\n" : "\n\n";
  return `${cssText.slice(0, insertIndex)}${prefix}${normalizedBlock.trimEnd()}${suffix}${cssText.slice(insertIndex)}`;
}
