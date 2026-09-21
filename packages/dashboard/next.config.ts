import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources, not prebuilt browser bundles.
  transpilePackages: ["@agent-rails/sdk", "@agent-rails/client", "@agent-rails/contract"],
  // A stray package-lock.json above the repo makes Next infer the wrong root
  // and trace the wrong files; pin it to the monorepo.
  outputFileTracingRoot: resolve(here, "../.."),
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-tooltip",
    ],
  },
};

export default nextConfig;
