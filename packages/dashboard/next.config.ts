import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@agent-rails/sdk", "@agent-rails/client", "@agent-rails/contract"],
  reactStrictMode: true,
};

export default nextConfig;
