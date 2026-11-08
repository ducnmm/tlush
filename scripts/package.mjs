import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = resolve(root, "dist"),
  artifacts = resolve(root, "artifacts");
const { version } = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(resolve(dist, "manifest.json"), "utf8"),
);
if (manifest.version !== version)
  throw Error("Build and package versions differ. Rebuild first.");
const entries = {};
async function collect(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink())
      throw Error("Release files must not be symbolic links.");
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile())
      entries[relative(dist, path).split(sep).join("/")] = [
        new Uint8Array(await readFile(path)),
        { mtime: new Date(2000, 0, 1) },
      ];
  }
}
await collect(dist);
const zip = zipSync(entries, { level: 9 }),
  name = `tlush-${version}.zip`;
await mkdir(artifacts, { recursive: true });
await writeFile(resolve(artifacts, name), zip);
await writeFile(
  resolve(artifacts, `${name}.sha256`),
  `${createHash("sha256").update(zip).digest("hex")}  ${name}\n`,
);
console.log(
  `Packaged artifacts/${name} (${zip.length.toLocaleString("en-US")} bytes)`,
);
