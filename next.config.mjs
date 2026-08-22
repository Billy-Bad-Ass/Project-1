// Sub-directory hosting (GitHub Pages project sites serve from /<repo>/).
// Without this every internal link and asset resolves against the domain root
// and 404s. Empty for a root domain.
const rawBasePath = (process.env.BASE_PATH ?? '').trim().replace(/\/+$/, '');
const basePath = rawBasePath === '' || rawBasePath === '/' ? '' : rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(basePath ? { basePath } : {}),
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
