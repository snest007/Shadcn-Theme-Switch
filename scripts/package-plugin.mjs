import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const pluginRoot = path.resolve(projectRoot, "plugin");
const distRoot = path.resolve(pluginRoot, "dist");
const releaseRoot = path.resolve(projectRoot, "release", "shadcn-theme-switch-plugin");

const requiredFiles = [
  path.resolve(pluginRoot, "manifest.json"),
  path.resolve(pluginRoot, "icon.png"),
  path.resolve(distRoot, "code.js"),
  path.resolve(distRoot, "ui.html"),
];

for (const filePath of requiredFiles) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required plugin asset: ${path.relative(projectRoot, filePath)}`);
  }
}

fs.rmSync(releaseRoot, { recursive: true, force: true });
fs.mkdirSync(releaseRoot, { recursive: true });
fs.cpSync(distRoot, path.resolve(releaseRoot, "dist"), { recursive: true });
fs.copyFileSync(path.resolve(pluginRoot, "manifest.json"), path.resolve(releaseRoot, "manifest.json"));
fs.copyFileSync(path.resolve(pluginRoot, "icon.png"), path.resolve(releaseRoot, "icon.png"));

const releaseReadme = `# Shadcn Theme Switch

This folder is the shareable Figma plugin package.

## Import in Figma

1. Open the Figma desktop app.
2. Go to Plugins > Development > Import plugin from manifest...
3. Choose \`manifest.json\` in this folder.

## Included files

- \`manifest.json\`
- \`dist/code.js\`
- \`dist/ui.html\`
- \`dist/ui.js\`
- \`icon.png\`
`;

fs.writeFileSync(path.resolve(releaseRoot, "README.md"), releaseReadme, "utf8");

console.log(`Prepared shareable plugin package in ${releaseRoot}`);
