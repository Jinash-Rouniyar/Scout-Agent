import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  eslint: {
    // Lint is run separately in CI; do not block builds.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
