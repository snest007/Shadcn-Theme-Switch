export function extractBlockRange(css, pattern) {
  const match = pattern.exec(css);
  if (!match) {
    return null;
  }

  const blockStart = css.indexOf("{", match.index);
  if (blockStart === -1) {
    return null;
  }

  let depth = 0;
  for (let index = blockStart; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          start: match.index,
          blockStart,
          contentStart: blockStart + 1,
          end: index + 1,
          content: css.slice(blockStart + 1, index),
        };
      }
    }
  }

  return null;
}

export function extractBlock(css, pattern) {
  return extractBlockRange(css, pattern)?.content ?? null;
}

export function parseDeclarations(block) {
  const declarations = {};
  if (!block) {
    return declarations;
  }

  const matcher = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match = matcher.exec(block);
  while (match) {
    declarations[match[1]] = match[2].trim();
    match = matcher.exec(block);
  }
  return declarations;
}

export function findManagedBlockRange(css, startMarker, endMarker) {
  const start = css.indexOf(startMarker);
  if (start === -1) {
    return null;
  }

  const end = css.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    return null;
  }

  return {
    start,
    end: end + endMarker.length,
    content: css.slice(start + startMarker.length, end),
  };
}
