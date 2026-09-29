import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));

// Set by the app rather than by the host, so Vercel and the VPS (Cloudflare tunnel straight to
// `next start`, no reverse proxy of ours in between) send the same headers.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
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
