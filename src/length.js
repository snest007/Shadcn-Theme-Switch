import { roundNumber } from "./utils.js";

export function parseLengthToPx(value, variables = {}) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return Number.NaN;
  }

  if (trimmed.startsWith("calc(") && trimmed.endsWith(")")) {
    const expression = trimmed.slice(5, -1).trim();

    const multiplierMatch = /^var\((--[\w-]+)\)\s*\*\s*([0-9.]+)$/.exec(expression);
    if (multiplierMatch) {
      return parseLengthToPx(variables[multiplierMatch[1]], variables) * Number.parseFloat(multiplierMatch[2]);
    }

    const addSubMatch = /^var\((--[\w-]+)\)\s*([+-])\s*([0-9.]+(?:px|rem))$/.exec(expression);
    if (addSubMatch) {
      const base = parseLengthToPx(variables[addSubMatch[1]], variables);
      const delta = parseLengthToPx(addSubMatch[3], variables);
      return addSubMatch[2] === "+" ? base + delta : base - delta;
    }
  }

  if (trimmed.startsWith("var(") && trimmed.endsWith(")")) {
    const variableName = trimmed.slice(4, -1).trim();
    return parseLengthToPx(variables[variableName], variables);
  }

  if (trimmed.endsWith("rem")) {
    return Number.parseFloat(trimmed) * 16;
  }

  if (trimmed.endsWith("px")) {
    return Number.parseFloat(trimmed);
  }

  return Number.parseFloat(trimmed);
}

export function serializeLengthPx(value) {
  return `${roundNumber(value, 4)}px`;
}
