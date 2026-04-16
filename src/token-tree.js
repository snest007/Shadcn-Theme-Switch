import { getIn, isTokenLeaf, refToSegments } from "./utils.js";

export function mergedTokenContext(...trees) {
  const merged = {};
  for (const tree of trees) {
    for (const [key, value] of Object.entries(tree ?? {})) {
      if (key === "$extensions") {
        continue;
      }
      merged[key] = value;
    }
  }
  return merged;
}

export function resolveTokenValue(value, context, seen = new Set()) {
  if (typeof value !== "string") {
    return value;
  }

  const pathSegments = refToSegments(value);
  if (!pathSegments) {
    return value;
  }

  const key = pathSegments.join(".");
  if (seen.has(key)) {
    throw new Error(`Circular token reference detected: ${value}`);
  }

  const target = getIn(context, pathSegments);
  if (!isTokenLeaf(target)) {
    throw new Error(`Unresolved token reference: ${value}`);
  }

  seen.add(key);
  return resolveTokenValue(target.$value, context, seen);
}

export function resolveTokenChain(value, context) {
  const chain = [];
  let current = value;
  const seen = new Set();

  while (typeof current === "string" && current.startsWith("{") && current.endsWith("}")) {
    const segments = refToSegments(current);
    const key = segments.join(".");
    if (seen.has(key)) {
      throw new Error(`Circular token reference detected: ${current}`);
    }
    seen.add(key);
    chain.push(current);
    const node = getIn(context, segments);
    if (!isTokenLeaf(node)) {
      throw new Error(`Unresolved token reference: ${current}`);
    }
    current = node.$value;
  }

  return {
    chain,
    value: current,
  };
}
