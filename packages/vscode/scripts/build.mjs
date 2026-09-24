// Bundles the extension and the relay it ships. `--production` minifies and drops source maps.

import * as fs from "node:fs"
import * as esbuild from "esbuild"

const production = process.argv.includes("--production")
if (production) fs.rmSync("dist", { recursive: true, force: true })

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  minify: production,
  sourcemap: !production,
  logLevel: "warning",
}

await esbuild.build({ ...common, entryPoints: ["src/extension.ts"], external: ["vscode"], outfile: "dist/extension.js" })
await esbuild.build({ ...common, entryPoints: ["../relay/src/main.ts"], loader: { ".md": "text" }, outfile: "dist/relay.js" })
