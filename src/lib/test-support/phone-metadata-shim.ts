/**
 * Lets `normalizePhone` work in node:test runs under tsx.
 *
 * libphonenumber-js's CommonJS entry does `require('../metadata.min.json')`.
 * Under tsx that resolves to the package's ESM wrapper `metadata.min.json.js`
 * and comes back as `{ default: … }`, so every number
 * parses as invalid and phone matching silently finds nobody. Next's bundler
 * and plain node are unaffected; this only matters for tests. Call it before
 * the first import of anything that reaches `@/lib/phone`.
 */
import fs from "fs";
import path from "path";
import Module from "module";

export function installPhoneMetadataShim(): void {
  const req = Module.createRequire(path.join(process.cwd(), "package.json"));
  const dir = path.dirname(req.resolve("libphonenumber-js/package.json"));
  for (const name of ["min", "max", "mobile", "full"]) {
    const json = path.join(dir, `metadata.${name}.json`);
    if (!fs.existsSync(json)) continue;
    const exports = JSON.parse(fs.readFileSync(json, "utf8"));
    // Seed both: which one `require` lands on depends on the resolver.
    for (const file of [json, `${json}.js`]) {
      const mod = new Module(file);
      mod.filename = file;
      mod.loaded = true;
      mod.exports = exports;
      req.cache[file] = mod;
    }
  }
}
