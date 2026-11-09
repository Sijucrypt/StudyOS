import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const resolve = createRequire(import.meta.url).resolve;
const source = dirname(resolve("pdfjs-dist/package.json"));
const target = fileURLToPath(new URL("../public/pdf-assets/", import.meta.url));
await mkdir(target, { recursive: true });
for (const directory of ["cmaps", "standard_fonts"]) {
  await cp(join(source, directory), join(target, directory), { recursive: true });
}
