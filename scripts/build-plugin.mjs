import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const pluginRoot = path.resolve(projectRoot, "plugin");
const sourceRoot = path.resolve(pluginRoot, "src");
const distRoot = path.resolve(pluginRoot, "dist");

fs.mkdirSync(distRoot, { recursive: true });

const uiBuild = await build({
  entryPoints: [path.resolve(sourceRoot, "ui.js")],
  bundle: true,
  format: "iife",
  target: "es2017",
  platform: "browser",
  minify: false,
  write: false,
});

const bundledUiJs = uiBuild.outputFiles[0].text;
const htmlTemplate = fs.readFileSync(path.resolve(sourceRoot, "ui.html"), "utf8");
const inlinedUiHtml = htmlTemplate.replace(
  '<script src="./ui.js"></script>',
  `<script>\n${bundledUiJs.replaceAll("</script>", "<\\/script>")}\n</script>`,
);

await build({
  entryPoints: [path.resolve(sourceRoot, "code.js")],
  outfile: path.resolve(distRoot, "code.js"),
  bundle: true,
  format: "iife",
  target: "es2017",
  platform: "browser",
  minify: false,
  define: {
    __html__: JSON.stringify(inlinedUiHtml),
  },
});

fs.writeFileSync(path.resolve(distRoot, "ui.js"), bundledUiJs, "utf8");
fs.writeFileSync(path.resolve(distRoot, "ui.html"), inlinedUiHtml, "utf8");
console.log(`Built plugin into ${distRoot}`);
