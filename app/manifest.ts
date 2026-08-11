import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Oakland Motor Care Ltd Operations',
    short_name: 'Oakland Motor Care',
    description: 'Workshop operations management for Oakland Motor Care Ltd.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f8fa',
    theme_color: '#10263f',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/logo.png', sizes: '1774x887', type: 'image/png' },
    ],
  };
}
