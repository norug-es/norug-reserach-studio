import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["192.168.56.1"],
  serverExternalPackages: ["pg"],
};

export default nextConfig;
