import "@/src/styles/tailwind.css"

import { Kumbh_Sans } from 'next/font/google'

const kumbh = Kumbh_Sans({
    weight: ['300', '400', '500', '600', '700','800','900'],
    subsets: ['latin'],
    display: 'swap',
    variable: '--font-kumbh',
})

export const metadata = {
  title: 'Spotlight | National Youth Empowerment & Entertainment Platform',
  description: 'Spotlight discovers, trains, promotes, and connects emerging talents through auditions, bootcamps, reality TV, public voting, media exposure, sponsorship, and post-show career pathways.',
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
        {staticStyles.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  )
}
