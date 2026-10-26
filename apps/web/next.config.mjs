/** @type {import('next').NextConfig} */
const API = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@divvy/shared"],
  // Same-origin API in every environment: Next proxies /api/* in dev, Nginx does it in production.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

export default nextConfig;
