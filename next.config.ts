import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "postgres",
    "@langfuse/otel",
    "@langfuse/tracing",
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-trace-node",
  ],
  outputFileTracingIncludes: {
    "/*": ["./scout_hero_logo.png"],
  },
  eslint: {
    // Lint is run separately in CI; do not block builds.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
