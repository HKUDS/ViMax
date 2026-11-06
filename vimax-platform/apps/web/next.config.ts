import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const currentDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  // 验证构建与运行中的 dev server 隔离（VIMAX_BUILD_DIST=.next-verify 时）
  distDir: process.env.VIMAX_BUILD_DIST ?? ".next",
  transpilePackages: ["@vimax/contracts"],
  outputFileTracingRoot: path.resolve(currentDir, "../.."),
};

export default withNextIntl(nextConfig);
