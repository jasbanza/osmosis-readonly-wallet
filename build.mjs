import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

/** Copy the manifest and popup markup next to the bundled scripts. */
function copyStatic() {
  cpSync("manifest.json", "dist/manifest.json");
  cpSync("src/popup.html", "dist/popup.html");
  cpSync("icons", "dist/icons", { recursive: true });
}

const options = {
  entryPoints: ["src/provider.ts", "src/bridge.ts", "src/popup.ts"],
  bundle: true,
  format: "iife",
  target: "chrome111",
  outdir: "dist",
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  copyStatic();
  console.log("Watching for changes. Reload the unpacked extension after each build.");
} else {
  await esbuild.build(options);
  copyStatic();
  console.log("Built to dist/. Load it unpacked from chrome://extensions.");
}
