import { defineConfig } from "@rspack/cli";
import { rspack } from "@rspack/core";
import RefreshPlugin from "@rspack/plugin-react-refresh";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";
const apiUrl = process.env.API_URL || "";

export default defineConfig({
  mode: isDev ? "development" : "production",
  entry: {
    main: "./src/main.tsx",
    "service-worker": {
      import: "./src/service-worker.ts",
      filename: "service-worker.js",
    },
    "shared-worker": {
      import: "./src/shared-worker.ts",
      filename: "shared-worker.js",
    },
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
    fallback: {
      fs: false,
      path: false,
      crypto: false,
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
      "__API_URL__": JSON.stringify(apiUrl || ''),
    }),
    isDev ? new RefreshPlugin() : null,
  ].filter(Boolean),
  devServer: {
    port: Number(process.env.WEB_PORT) || 3070,
    hot: true,
    historyApiFallback: true,
    proxy: [
      {
        context: ["/trpc", "/auth"],
        target: process.env.API_URL || "http://localhost:3081",
      },
    ],
  },
  optimization: {
    minimize: !isDev,
  },
});
