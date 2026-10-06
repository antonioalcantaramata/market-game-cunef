import type { NextConfig } from "next";

// Static site for GitHub Pages: no server, every page is plain HTML + JS that
// talks to Supabase from the browser. NEXT_PUBLIC_BASE_PATH is the repository
// name (e.g. "/market-game") when the site lives at <user>.github.io/<repo>/.
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
