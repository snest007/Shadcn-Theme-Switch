import { replaceAllString, roundNumber } from "./utils.js";

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function rgbToHex(components) {
  return `#${components
    .map((component) => Math.round(clamp01(component) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

export function isColorObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.colorSpace === "srgb";
}

export function isFigmaColorObject(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Number.isFinite(value.r) &&
    Number.isFinite(value.g) &&
    Number.isFinite(value.b)
  );
}

export function makeColor(components, alpha = 1) {
  const safeComponents = components.map((component) => roundNumber(clamp01(component), 12));
  return {
    colorSpace: "srgb",
    components: safeComponents,
    alpha: roundNumber(clamp01(alpha), 12),
    hex: rgbToHex(safeComponents),
  };
}

export function normalizeColor(color) {
  if (isColorObject(color)) {
    return color;
  }

  if (isFigmaColorObject(color)) {
    return makeColor([color.r, color.g, color.b], Number.isFinite(color.a) ? color.a : 1);
  }

  return null;
}

export function toFigmaColor(color) {
  const normalized = normalizeColor(color);
  if (!normalized) {
    throw new Error("toFigmaColor expects an srgb color object.");
  }

  return {
    r: normalized.components[0],
    g: normalized.components[1],
    b: normalized.components[2],
    a: Number.isFinite(normalized.alpha) ? normalized.alpha : 1,
  };
}

function parseCssNumber(value, rangeBase = 1) {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    return Number.parseFloat(trimmed) / 100;
  }
  const parsed = Number.parseFloat(trimmed);
  return rangeBase === 255 && parsed > 1 ? parsed / 255 : parsed;
}

function parseHexColor(value) {
  const hex = value.replace("#", "").trim();
  if (![3, 4, 6, 8].includes(hex.length)) {
    throw new Error(`Unsupported hex color: ${value}`);
  }

  const normalized =
    hex.length <= 4
      ? hex
          .split("")
          .map((part) => part.repeat(2))
          .join("")
      : hex;

  const hasAlpha = normalized.length === 8;
  const components = [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
  const alpha = hasAlpha ? Number.parseInt(normalized.slice(6, 8), 16) / 255 : 1;

  return makeColor(components, alpha);
}

function parseRgbColor(value) {
  const body = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
  const [rgbPart, alphaPart] = body.split("/").map((part) => part.trim());
  const pieces = replaceAllString(rgbPart, ",", " ").split(/\s+/).filter(Boolean);
  if (pieces.length < 3) {
    throw new Error(`Unsupported rgb color: ${value}`);
  }

  const components = pieces.slice(0, 3).map((component) => parseCssNumber(component, 255));
  const alpha = alphaPart ? parseCssNumber(alphaPart, 1) : 1;
  return makeColor(components, alpha);
}

function oklchToSrgb({ l, c, h, alpha }) {
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const linear = [
    lPrime ** 3,
    mPrime ** 3,
    sPrime ** 3,
  ];

  const rgbLinear = [
    +4.0767416621 * linear[0] - 3.3077115913 * linear[1] + 0.2309699292 * linear[2],
    -1.2684380046 * linear[0] + 2.6097574011 * linear[1] - 0.3413193965 * linear[2],
    -0.0041960863 * linear[0] - 0.7034186147 * linear[1] + 1.707614701 * linear[2],
  ];

  const components = rgbLinear.map((component) => {
    if (component <= 0.0031308) {
      return 12.92 * component;
    }
    return 1.055 * component ** (1 / 2.4) - 0.055;
  });

  return makeColor(components, alpha);
}

function parseOklchColor(value) {
  const body = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
  const [mainPart, alphaPart] = body.split("/").map((part) => part.trim());
  const pieces = mainPart.split(/\s+/).filter(Boolean);
  if (pieces.length < 3) {
    throw new Error(`Unsupported oklch color: ${value}`);
  }

  const l = parseCssNumber(pieces[0], 1);
  const c = Number.parseFloat(pieces[1]);
  const h = Number.parseFloat(pieces[2]);
  const alpha = alphaPart ? parseCssNumber(alphaPart, 1) : 1;

  return oklchToSrgb({ l, c, h, alpha });
}

export function parseCssColor(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) {
    return parseHexColor(trimmed);
  }
  if (trimmed.startsWith("rgb")) {
    return parseRgbColor(trimmed);
  }
  if (trimmed.startsWith("oklch")) {
    return parseOklchColor(trimmed);
  }

  throw new Error(`Unsupported CSS color value: ${value}`);
}

export function sameRgb(left, right, tolerance = 1e-4) {
  const normalizedLeft = normalizeColor(left);
  const normalizedRight = normalizeColor(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft.components.every(
    (component, index) => Math.abs(component - normalizedRight.components[index]) <= tolerance,
  );
}

export function sameColor(left, right, tolerance = 1e-4) {
  const normalizedLeft = normalizeColor(left);
  const normalizedRight = normalizeColor(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    sameRgb(normalizedLeft, normalizedRight, tolerance) &&
    Math.abs((normalizedLeft.alpha ?? 1) - (normalizedRight.alpha ?? 1)) <= tolerance
  );
}

export function applyAlpha(color, factor) {
  const normalized = normalizeColor(color);
  if (!normalized) {
    throw new Error("applyAlpha expects an srgb color object.");
  }

  return makeColor(normalized.components, (normalized.alpha ?? 1) * factor);
}

export function serializeCssColor(color) {
  const normalized = normalizeColor(color);
  if (!normalized) {
    throw new Error("serializeCssColor expects an srgb color object.");
  }

  const [red, green, blue] = normalized.components.map((component) => Math.round(clamp01(component) * 255));
  const alpha = roundNumber(normalized.alpha ?? 1, 4);

  if (Math.abs(alpha - 1) <= 1e-6) {
    return rgbToHex(normalized.components);
  }

  return `rgb(${red} ${green} ${blue} / ${alpha})`;
}
