import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return { name: 'Work Buddy', short_name: 'Work Buddy', description: 'Live dashboard for your workday', start_url: '/', display: 'standalone', background_color: '#111310', theme_color: '#161914', lang: 'uk', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }
}
