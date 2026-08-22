/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the whole site becomes plain HTML/CSS/JS in ./out,
  // which every free host (Cloudflare Pages, Netlify, GitHub Pages) serves for $0.
  output: 'export',
  trailingSlash: true,
  images: {
    // The static exporter has no image optimisation server, so images are
    // passed through untouched. Source images are already CDN-hosted.
    unoptimized: true,
  },
};

export default nextConfig;
