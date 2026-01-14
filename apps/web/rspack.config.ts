import { defineConfig } from "@rspack/cli";
import { rspack, type Configuration } from "@rspack/core";
import RefreshPlugin from "@rspack/plugin-react-refresh";
import path from "path";
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
  },
  optimization: {
    minimize: !isDev,
  },
};

// Service Worker configuration - built separately without HMR/dev server pollution
const serviceWorkerConfig: Configuration = {
  name: "service-worker",
  mode: isDev ? "development" : "production",
  target: "webworker",
  entry: {
    "service-worker": "./src/service-worker.ts",
  },
  output: {
    publicPath: "/",
    filename: "[name].js",
    // Don't clean - main config handles that
    clean: false,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    fallback: {
      // sql.js tries to require these Node.js modules but doesn't need them in browser
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
            },
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new rspack.DefinePlugin({
      "process.env.API_URL": JSON.stringify(apiUrl),
    }),
  ],
  optimization: {
    minimize: !isDev,
  },
  // No dev server for service worker - it should be a static build
};

export default defineConfig([mainConfig, serviceWorkerConfig]);
