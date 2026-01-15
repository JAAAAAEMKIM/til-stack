import { defineConfig } from "@rspack/cli";
import { rspack, type Configuration } from "@rspack/core";
import RefreshPlugin from "@rspack/plugin-react-refresh";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";
const apiUrl = process.env.API_URL || "";

// Main app configuration
const mainConfig: Configuration = {
  name: "main",
  mode: isDev ? "development" : "production",
  entry: {
    main: "./src/main.tsx",
  },
  output: {
    publicPath: "/",
    clean: true,
  },
  experiments: {
    css: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: {
                syntax: "typescript",
                tsx: true,
              },
              transform: {
                react: {
                  runtime: "automatic",
                  development: isDev,
                  refresh: isDev,
                },
              },
            },
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: "postcss-loader",
            options: {
              postcssOptions: {
                plugins: ["tailwindcss", "autoprefixer"],
              },
            },
          },
        ],
        type: "css/auto",
      },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
    }),
    new rspack.DefinePlugin({
      "process.env.API_URL": JSON.stringify(apiUrl),
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        {
          from: "node_modules/sql.js/dist/sql-wasm.wasm",
          to: "sql.js/sql-wasm.wasm",
        },
      ],
    }),
    isDev ? new RefreshPlugin() : null,
  ].filter(Boolean) as Configuration["plugins"],
  devServer: {
    port: 3000,
    hot: true,
    historyApiFallback: true,
    proxy: [
      {
        context: ["/trpc", "/auth"],
        target: "http://localhost:3001",
      },
    ],
    // Serve service-worker.js from disk (built by esbuild, not rspack)
    setupMiddlewares: (middlewares) => {
      const swPath = path.resolve(__dirname, "dist/service-worker.js");
      middlewares.unshift((req, res, next) => {
        if (req.url === "/service-worker.js") {
          if (fs.existsSync(swPath)) {
            res.setHeader("Content-Type", "application/javascript");
            res.end(fs.readFileSync(swPath, "utf-8"));
            return;
          }
        }
        next();
      });
      return middlewares;
    },
  },
  optimization: {
    minimize: !isDev,
  },
};

// Service worker is built separately by esbuild (build-sw.mjs)
// This avoids rspack dev server injecting HMR code into the SW

export default defineConfig(mainConfig);
