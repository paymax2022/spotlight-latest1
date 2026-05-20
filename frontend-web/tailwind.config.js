/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0D0D0D',
        'bg-card': '#161616',
        'bg-card-hover': '#1e1e1e',
        'accent-gold': '#D4A843',
        'accent-gold-light': '#E8C46A',
        'accent-red': '#C8102E',
        foreground: '#F5F0E8',
        'foreground-muted': 'rgba(245,240,232,0.5)',
        'foreground-dim': 'rgba(245,240,232,0.25)',
        border: 'rgba(245,240,232,0.08)',
        'border-gold': 'rgba(212,168,67,0.3)',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
      },
      fontSize: {
        'hero': 'clamp(3.5rem, 12vw, 9rem)',
        'display': 'clamp(2.5rem, 7vw, 6rem)',
        'headline': 'clamp(1.8rem, 4vw, 3.5rem)',
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, #D4A843 0%, #F0D080 50%, #C8922A 100%)',
        'dark-gradient': 'linear-gradient(180deg, #0D0D0D 0%, #161616 100%)',
      },
      animation: {
        'float': 'float-slow 6s ease-in-out infinite',
        'pulse-gold': 'pulse-gold 2s ease-in-out infinite',
        'shimmer': 'shimmer 4s linear infinite',
      },
      boxShadow: {
        'gold': '0 0 60px rgba(212,168,67,0.15), 0 0 120px rgba(212,168,67,0.05)',
        'gold-sm': '0 4px 20px rgba(212,168,67,0.25)',
        'card': '0 4px 40px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
};