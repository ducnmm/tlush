import { writeDependencyNotices } from "./licenses.mjs";
import { build, transform } from "esbuild";
import { mkdir, cp, rm, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = resolve(root, "dist");
const development = process.argv.includes("--dev");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, "public"), dist, {
  recursive: true,
  filter: (path) => !basename(path).startsWith("."),
});
const result = await build({
  absWorkingDir: root,
  entryPoints: [
    "src/background.js",
    "src/provider.js",
    "src/content.js",
    "src/popup.js",
  ],
  outdir: dist,
  bundle: true,
  metafile: true,
  loader: { ".png": "dataurl" },
  format: "iife",
  target: "chrome120",
  platform: "browser",
  minify: !development,
  legalComments: "eof",
});
const css = await transform(
  await readFile(resolve(root, "public/popup.css"), "utf8"),
  {
    loader: "css",
    minify: !development,
    target: "chrome120",
    legalComments: "eof",
  },
);
await writeFile(resolve(dist, "popup.css"), css.code);
await writeDependencyNotices(result.metafile, root, dist);
console.log(
  `Built ${development ? "development" : "release"} extension in dist/`,
);
