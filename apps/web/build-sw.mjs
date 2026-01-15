#!/usr/bin/env node
import * as esbuild from "esbuild";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: [path.resolve(__dirname, "src/service-worker.ts")],
  bundle: true,
  outfile: path.resolve(__dirname, "dist/service-worker.js"),
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: true,
  minify: !isDev,
  define: {
    "process.env.API_URL": '""',
  },
  // sql.js tries to require these Node.js modules but doesn't need them in browser
  alias: {
    fs: path.resolve(__dirname, "src/shims/empty.js"),
    path: path.resolve(__dirname, "src/shims/empty.js"),
    crypto: path.resolve(__dirname, "src/shims/empty.js"),
  },
};

if (isDev) {
  // Watch mode for development
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("[SW Build] Watching for changes...");
} else {
  // One-time build for production
  await esbuild.build(buildOptions);
  console.log("[SW Build] Service worker built successfully");
}
