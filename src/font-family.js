const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

export function splitFontFamilyList(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }

  const families = [];
  let current = "";
  let quote = null;

  for (const character of text) {
    if ((character === "'" || character === '"') && (!quote || quote === character)) {
      quote = quote === character ? null : character;
      current += character;
      continue;
    }

    if (character === "," && !quote) {
      if (current.trim()) {
        families.push(current.trim());
      }
      current = "";
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    families.push(current.trim());
  }

  return families;
}

export function normalizeFontFamilyName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  const unquoted = trimmed.replace(/^['"]+|['"]+$/g, "").trim();
  return unquoted;
}

export function isGenericFontFamily(value) {
  return GENERIC_FONT_FAMILIES.has(normalizeFontFamilyName(value).toLowerCase());
}

export function extractPrimaryFontFamily(value) {
  const families = splitFontFamilyList(value);
  for (const family of families) {
    const normalized = normalizeFontFamilyName(family);
    if (!normalized || normalized.startsWith("var(") || isGenericFontFamily(normalized)) {
      continue;
    }
    return normalized;
  }

  return normalizeFontFamilyName(families[0] || value);
}
