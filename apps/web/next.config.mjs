/** @type {import('next').NextConfig} */
const API = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@divvy/shared"],
  // Divvy uses plain <img>, never next/image. Turning the optimizer off makes /_next/image a 404, which
  // removes Next 14's image-optimizer advisories (critical RCE included; docs/AUDIT.md, dependencies).
  images: { unoptimized: true },
  // /API/launch must not reach the API through the rewrite below while skipping Nginx's /api/ rules (audit).
  experimental: { caseSensitiveRoutes: true },
  // Same-origin API in every environment: Next proxies /api/* in dev, Nginx does it in production.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

export default nextConfig;
