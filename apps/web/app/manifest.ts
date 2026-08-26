import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return { name: 'Work Buddy', short_name: 'Work Buddy', description: 'Live dashboard for your workday', start_url: '/', display: 'fullscreen', orientation: 'any', background_color: '#000000', theme_color: '#000000', lang: 'uk', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }
}
