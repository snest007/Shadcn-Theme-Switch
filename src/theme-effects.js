import { parseCssColor, serializeCssColor } from "./color.js";
import { parseLengthToPx, serializeLengthPx } from "./length.js";

function splitTopLevel(value, separator) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const character of value) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (character === separator && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function tokenizeCssValue(value) {
  const tokens = [];
  let depth = 0;
  let current = "";

  for (const character of value.trim()) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    }

    if (/\s/.test(character) && depth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function isCssColorToken(token) {
  const normalized = token.trim().toLowerCase();
  return (
    normalized.startsWith("#") ||
    normalized.startsWith("rgb(") ||
    normalized.startsWith("rgba(") ||
    normalized.startsWith("hsl(") ||
    normalized.startsWith("hsla(") ||
    normalized.startsWith("oklch(") ||
    normalized.startsWith("color(")
  );
}

export function parseBoxShadowCss(value, { forceInset = false } = {}) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "none") {
    return [];
  }

  return splitTopLevel(trimmed, ",").map((layerText) => {
    const tokens = tokenizeCssValue(layerText);
    if (tokens.length < 3) {
      throw new Error(`Unsupported box-shadow layer: ${layerText}`);
    }

    let hasInset = false;
    if (tokens[0].toLowerCase() === "inset") {
      hasInset = true;
      tokens.shift();
    }

    const colorIndex = [...tokens].reverse().findIndex((token) => isCssColorToken(token));
    if (colorIndex === -1) {
      throw new Error(`Missing color in box-shadow layer: ${layerText}`);
    }

    const actualColorIndex = tokens.length - 1 - colorIndex;
    const colorValue = tokens.splice(actualColorIndex, 1)[0];
    const lengths = tokens.map((token) => parseLengthToPx(token));
    if (lengths.length < 2 || lengths.length > 4 || lengths.some((length) => !Number.isFinite(length))) {
      throw new Error(`Unsupported box-shadow offsets in layer: ${layerText}`);
    }

    const layer = {
      offsetX: lengths[0],
      offsetY: lengths[1],
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      color: parseCssColor(colorValue),
    };

    if (forceInset || hasInset) {
      layer.inset = true;
    }

    return layer;
  });
}

export function serializeBoxShadow(layers, { inset = false } = {}) {
  if (!Array.isArray(layers) || layers.length === 0) {
    return "none";
  }

  return layers
    .map((layer) => {
      const prefix = inset || layer.inset ? "inset " : "";
      return `${prefix}${serializeLengthPx(layer.offsetX)} ${serializeLengthPx(layer.offsetY)} ${serializeLengthPx(layer.blur)} ${serializeLengthPx(layer.spread)} ${serializeCssColor(layer.color)}`.trim();
    })
    .join(", ");
}
