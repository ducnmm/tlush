import { readFile, readdir } from "node:fs/promises";
import { resolve, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const patterns = [
  /suiprivkey1[0-9a-z]{30,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/,
  /\/Users\/[^/\s]+\//,
];
const failures = [];
async function scan(directory) {
  for (const entry of await readdir(resolve(root, directory), {
    withFileTypes: true,
  })) {
    const path = resolve(root, directory, entry.name);
    if (entry.isSymbolicLink()) {
      failures.push(`${relative(root, path)}: unexpected symlink`);
      continue;
    }
    if (entry.isDirectory()) {
      await scan(relative(root, path));
      continue;
    }
    if (
      ![
        ".js",
        ".mjs",
        ".json",
        ".html",
        ".css",
        ".md",
        ".swift",
        ".yml",
      ].includes(extname(path))
    )
      continue;
    const text = await readFile(path, "utf8");
    if (patterns.some((pattern) => pattern.test(text)))
      failures.push(
        `${relative(root, path)}: possible credential or personal path`,
      );
  }
}
for (const directory of [
  "src",
  "public",
  "scripts",
  "tests",
  "docs",
  ".github",
])
  await scan(directory);
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const manifest = JSON.parse(
  await readFile(resolve(root, "public/manifest.json"), "utf8"),
);
if (pkg.version !== manifest.version)
  failures.push("Package and manifest versions differ");
if (failures.length) throw Error(failures.join("\n"));
console.log("Repository hygiene checks passed");
