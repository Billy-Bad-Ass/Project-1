import type { MetadataRoute } from 'next';
import { site } from '@config/site.config';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    // Points at the index written by src/pipeline/sitemap.ts after the build.
    sitemap: `${site.url}${site.basePath}/sitemap.xml`,
    host: site.url,
  };
}
