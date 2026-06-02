// import 'swiper/css';
// import "swiper/css/navigation";
// import "swiper/css/pagination";
import "/public/assets/css/bootstrap.min.css"        
import "/public/assets/css/all.min.css"
import "/public/assets/css/animate.css"
import "/public/assets/css/magnific-popup.css"
import "/public/assets/css/meanmenu.css"
import "/public/assets/css/swiper-bundle.min.css"
import "/public/assets/css/nice-select.css"
import "/public/assets/css/main.css"
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

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${kumbh.className} ${kumbh.variable}`}>
      <body className={`${kumbh.className} ${kumbh.variable}`}>{children}</body>
    </html>
  )
}
