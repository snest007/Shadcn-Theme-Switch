export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function hasOwn(object, key) {
  return object != null && Object.prototype.hasOwnProperty.call(object, key);
}

export function fromEntries(entries) {
  const result = {};
  for (const [key, value] of entries) {
    result[key] = value;
  }
  return result;
}

export function replaceAllString(value, searchValue, replaceValue) {
  return String(value).split(searchValue).join(replaceValue);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isTokenLeaf(node) {
  return isPlainObject(node) && hasOwn(node, "$type") && hasOwn(node, "$value");
}

export function roundNumber(value, precision = 6) {
  if (!Number.isFinite(value)) {
    return value;
  }

  return Number.parseFloat(value.toFixed(precision));
}

export function tokenRef(pathLike) {
  const segments = Array.isArray(pathLike) ? pathLike : String(pathLike).split(".");
  return `{${segments.join(".")}}`;
}

export function refToSegments(ref) {
  if (typeof ref !== "string" || !ref.startsWith("{") || !ref.endsWith("}")) {
    return null;
  }

  return ref.slice(1, -1).split(".");
}

export function aliasTargetToRef(targetName) {
  return tokenRef(String(targetName).split("/"));
}

export function getIn(root, pathSegments) {
  let current = root;
  for (const segment of pathSegments) {
    if (!isPlainObject(current) || !hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function setIn(root, pathSegments, value) {
  let current = root;
  pathSegments.slice(0, -1).forEach((segment) => {
    if (!isPlainObject(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  });
  current[pathSegments[pathSegments.length - 1]] = value;
}

export function summarizeValue(value) {
  if (typeof value === "string") {
    return value;
  }

  if (isPlainObject(value) && value.hex) {
    return `${value.hex} @${roundNumber(value.alpha ?? 1, 4)}`;
  }

  return value;
}

export function walkTokenLeaves(root, visit, pathSegments = []) {
  if (!isPlainObject(root)) {
    return;
  }

  if (isTokenLeaf(root)) {
    visit(root, pathSegments);
    return;
  }

  for (const [key, value] of Object.entries(root)) {
    if (key === "$extensions") {
      continue;
    }
    walkTokenLeaves(value, visit, [...pathSegments, key]);
  }
}
