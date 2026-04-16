import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getDefaultThemeContract } from "../src/generator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, "..", "src", "theme-default-contract.generated.js");
const contract = getDefaultThemeContract();

const fileContents = `export const defaultThemeContract = ${JSON.stringify(contract, null, 2)};\n`;
fs.writeFileSync(outputPath, fileContents, "utf8");
console.log(`Wrote ${outputPath}`);
