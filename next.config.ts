import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The portfolio page became part of the research hub: holdings sit on each thesis.
  async redirects() {
    return [{ source: "/portfolio", destination: "/", permanent: false }];
  },
};

export default nextConfig;
