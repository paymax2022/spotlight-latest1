import styles from './Preloader.module.css'

export default function Preloader() {
    return (
        <div className={styles.root} role="status" aria-live="polite" aria-atomic="true">
            <div className={styles.lockup}>
                <svg viewBox="0 0 180 180" aria-hidden="true">
                    <defs>
                        <linearGradient id="sp-metal" x2="100%" y2="100%">
                            <stop stopColor="#ffe0b2" />
                            <stop offset=".46" stopColor="#efa97a" />
                            <stop offset="1" stopColor="#ad67d3" />
                        </linearGradient>
                        <linearGradient id="sp-light">
                            <stop stopColor="#efa97a" stopOpacity="0" />
                            <stop offset=".5" stopColor="#fff1d5" />
                            <stop offset="1" stopColor="#efa97a" stopOpacity="0" />
                        </linearGradient>
                        <radialGradient id="sp-halo">
                            <stop stopColor="#efa97a" stopOpacity=".3" />
                            <stop offset="1" stopColor="#efa97a" stopOpacity="0" />
                        </radialGradient>
                        <path id="sp-mark" d="M7 3 43 13v14L18 39v-9l14-7-25-7V3Zm0 20 13 4v13l23-10v13L7 53V23Z" />
                        <clipPath id="sp-mark-mask">
                            <use href="#sp-mark" transform="translate(54 49) scale(1.44)" />
                        </clipPath>
                    </defs>
                    <circle cx="90" cy="90" r="74" fill="none" stroke="#b39bbd" strokeOpacity=".19" />
                    <circle cx="90" cy="90" r="64" fill="none" stroke="#b39bbd" strokeOpacity=".12" />
                    <path d="M90 10v8m80 72h-8m-72 80v-8m-80-72h8" fill="none" stroke="#bba4c5" strokeOpacity=".48" />
                    <use href="#sp-mark" transform="translate(54 49) scale(1.44)" fill="url(#sp-metal)" opacity=".84" />
                    <g clipPath="url(#sp-mark-mask)">
                        <g className={styles.sweep}>
                            <rect x="64" y="35" width="52" height="110" fill="url(#sp-light)" transform="rotate(20 90 90)" opacity=".85" />
                        </g>
                    </g>
                    <g className={styles.rotor} fill="none">
                        <path d="M24 57a74 74 0 0 1 66-41" stroke="url(#sp-metal)" strokeWidth="1.5" strokeLinecap="round" />
                        <circle cx="90" cy="16" r="14" fill="url(#sp-halo)" />
                        <circle cx="90" cy="16" r="2.3" fill="#ffe3bc" />
                    </g>
                </svg>
                <p className={styles.wordmark} aria-hidden="true">SPOTLIGHT</p>
                <p className={styles.status}>Loading Spotlight</p>
            </div>
        </div>
    )
}
