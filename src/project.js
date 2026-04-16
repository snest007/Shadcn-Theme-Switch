import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { extractBlock, parseDeclarations } from "./css-blocks.js";
import { listFilesRecursive, readJson } from "./file-utils.js";

function humanizeFontName(identifier) {
  return identifier.replaceAll("_", " ");
}

function detectFontVariables(projectDir) {
  const files = listFilesRecursive(projectDir, [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
  const fonts = {};

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const regex = /const\s+\w+\s*=\s*([A-Za-z0-9_]+)\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
    let match = regex.exec(source);
    while (match) {
      const fontFactory = match[1];
      const options = match[2];
      const variableMatch = /variable\s*:\s*["'](--font-[\w-]+)["']/.exec(options);
      if (variableMatch && !fonts[variableMatch[1]]) {
        fonts[variableMatch[1]] = humanizeFontName(fontFactory);
      }
      match = regex.exec(source);
    }
  }

  return fonts;
}

export function hydratePresetSource({ preset, base = "base", template = "next" }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `shadcn-preset-${preset}-`));
  const projectName = "preset-source";
  const args = [
    "shadcn@latest",
    "init",
    "--preset",
    preset,
    "--template",
    template,
    "--base",
    base,
    "--cwd",
    tempRoot,
    "--name",
    projectName,
    "--silent",
  ];

  const result = spawnSync("npx", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
    },
  });

  if (result.status !== 0) {
    throw new Error(`Failed to hydrate preset ${preset}: ${result.stderr || result.stdout}`);
  }

  return {
    projectDir: path.join(tempRoot, projectName),
    command: `npx ${args.join(" ")}`,
  };
}

export function loadProjectSource(projectDir) {
  const resolvedProjectDir = path.resolve(projectDir);
  const componentsPath = path.join(resolvedProjectDir, "components.json");

  if (!fs.existsSync(componentsPath)) {
    throw new Error(`Could not find components.json in ${resolvedProjectDir}`);
  }

  const components = readJson(componentsPath);
  if (!components?.tailwind?.cssVariables) {
    throw new Error("This generator requires a shadcn project with cssVariables=true.");
  }

  const cssPath = path.resolve(resolvedProjectDir, components.tailwind.css);
  if (!fs.existsSync(cssPath)) {
    throw new Error(`Could not find the configured Tailwind CSS file: ${cssPath}`);
  }

  const css = fs.readFileSync(cssPath, "utf8");
  const rootBlock = extractBlock(css, /:root\s*\{/g);
  const darkBlock = extractBlock(css, /\.dark\s*\{/g);
  const themeInlineBlock = extractBlock(css, /@theme\s+inline\s*\{/g);

  return {
    projectDir: resolvedProjectDir,
    componentsPath,
    cssPath,
    components,
    css,
    declarations: {
      root: parseDeclarations(rootBlock),
      dark: parseDeclarations(darkBlock),
      themeInline: parseDeclarations(themeInlineBlock),
    },
    fonts: detectFontVariables(resolvedProjectDir),
  };
}
