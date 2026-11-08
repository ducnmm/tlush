import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function writeDependencyNotices(metafile, root, dist) {
  const directories = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const marker = input.lastIndexOf("node_modules/");
    if (marker < 0) continue;
    const prefix = input.slice(0, marker + 13),
      segments = input.slice(marker + 13).split("/");
    const name = segments[0].startsWith("@")
      ? segments.slice(0, 2).join("/")
      : segments[0];
    directories.add(resolve(root, prefix, name));
  }
  const notices = [];
  for (const directory of [...directories].sort()) {
    const pkg = JSON.parse(
      await readFile(resolve(directory, "package.json"), "utf8"),
    );
    const licenseName = (await readdir(directory)).find((name) =>
      /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name),
    );
    const licensePath = licenseName
      ? resolve(directory, licenseName)
      : pkg.license === "Apache-2.0"
        ? resolve(root, "node_modules/@mysten/sui/LICENSE")
        : null;
    if (!licensePath)
      throw Error(`Missing license text for bundled dependency ${pkg.name}`);
    const text = await readFile(licensePath, "utf8");
    const author =
      typeof pkg.author === "string" ? pkg.author : pkg.author?.name || "";
    notices.push(
      `${pkg.name} ${pkg.version}\nLicense: ${pkg.license}\nAuthor: ${author}\n\n${text.trim()}`,
    );
  }
  await writeFile(
    resolve(dist, "THIRD_PARTY_LICENSES.txt"),
    `${notices.join("\n\n----------------------------------------\n\n")}\n`,
  );
}
