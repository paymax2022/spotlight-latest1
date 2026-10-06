import "@/src/styles/tailwind.css"

import { Kumbh_Sans } from 'next/font/google'

const kumbh = Kumbh_Sans({
    weight: ['300', '400', '500', '600', '700','800','900'],
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-kumbh',
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.spotlightng.com'
const siteTitle = 'Spotlight | National Youth Empowerment & Entertainment Platform'
const siteDescription = 'Spotlight discovers, trains, promotes, and connects emerging talents through auditions, bootcamps, reality TV, public voting, media exposure, sponsorship, and post-show career pathways.'

export const metadata = {
  // Resolves every relative URL-based metadata field (og:url, canonical,
  // og:image) site-wide — child segments may keep using relative paths.
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: '/',
    siteName: 'Spotlight',
    type: 'website',
    images: [
      {
        url: '/assets/img/shape/banner-home.png',
        width: 1280,
        height: 480,
        alt: 'Spotlight — National Youth Empowerment & Entertainment Platform',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: ['/assets/img/shape/banner-home.png'],
  },
}

const staticStyles = [
  '/assets/css/bootstrap.min.css',
  '/assets/css/all.min.css',
  '/assets/css/animate.css',
  '/assets/css/magnific-popup.css',
  '/assets/css/meanmenu.css',
  '/assets/css/swiper-bundle.min.css',
  '/assets/css/nice-select.css',
  '/assets/css/main.css',
]

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={kumbh.variable}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var h=location.hash;if(!/[#&]type=recovery/.test(h))return;var p=new URLSearchParams(h.slice(1));fetch('/api/auth/recovery-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({access_token:p.get('access_token'),refresh_token:p.get('refresh_token')})}).finally(function(){location.replace('/auth/reset-password')})})()",
          }}
        />
        {staticStyles.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  )
}
