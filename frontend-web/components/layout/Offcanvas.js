'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import MobileMenu from './MobileMenu'

// Quick-nav links shown when the user is signed in
const USER_LINKS = [
  { href: '/user-dashboard',     icon: 'fas fa-th-large',       label: 'My Dashboard'     },
  { href: '/user-dashboard?tab=applications', icon: 'fas fa-file-alt', label: 'My Applications' },
  { href: '/contestant/votes',   icon: 'fas fa-vote-yea',        label: 'My Votes'         },
  { href: '/open-mic/profile',   icon: 'fas fa-microphone-alt',  label: 'Open Mic Profile' },
]

function Avatar({ name, photoUrl, size = 56 }) {
  const initials = (name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        width={size}
        height={size}
        style={{
          width: size, height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '2px solid #f59e0b',
        }}
      />
    )
  }

  return (
    <div style={{
      width: size, height: size,
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #f59e0b, #d97706)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, color: '#000',
      flexShrink: 0, border: '2px solid #f59e0b',
    }}>
      {initials}
    </div>
  )
}

export default function Offcanvas({ isOffCanvas, handleOffCanvas }) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [user, setUser]         = useState(null)
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  // Load session on open and subscribe to auth changes
  useEffect(() => {
    let mounted = true

    async function loadUser() {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      if (!mounted) return
      setUser(session?.user ?? null)

      if (session?.user) {
        // Select all profile fields; avatar_url and role are added in migration 20260602130000.
        // If they don't exist yet the query still returns partial data — handled below with ??.
        const { data } = await supabase
          .from('user_profiles')
          .select('full_name, avatar_url, role, state, talent_category')
          .eq('id', session.user.id)
          .maybeSingle()
        if (mounted) setProfile(data ?? null)
      }
      if (mounted) setLoading(false)
    }

    loadUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      if (!session?.user) setProfile(null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  async function handleSignOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setSigningOut(false)
    handleOffCanvas()
    router.push('/')
  }

  const displayName = profile?.full_name
    || user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || 'Spotlight Member'

  const email    = user?.email ?? null
  const photoUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || null
  // Show 'admin'-family roles as a badge; hide generic 'member' to reduce noise
  const role     = (() => {
    const r = profile?.role || user?.user_metadata?.role || user?.app_metadata?.role || null
    if (!r || r === 'member') return profile?.talent_category || null
    return r
  })()

  return (
    <>
      <div className="fix-area">
        <div className={`offcanvas__info ${isOffCanvas ? 'info-open' : ''}`}>
          <div className="offcanvas__wrapper">
            <div className="offcanvas__content">

              {/* ── Top: Logo + Close ────────────────────────────── */}
              <div className="offcanvas__top mb-4 d-flex justify-content-between align-items-center">
                <div className="offcanvas__logo">
                  <Link href="/" onClick={handleOffCanvas}>
                    <img src="/assets/img/logo/logo.png" alt="Spotlight logo" />
                  </Link>
                </div>
                <div className="offcanvas__close" onClick={handleOffCanvas}>
                  <button aria-label="Close panel">
                    <i className="fas fa-times" />
                  </button>
                </div>
              </div>

              {/* ── User Profile Card ─────────────────────────────── */}
              {loading ? (
                <div style={{ padding: '20px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: '#e5e7eb', animation: 'pulse 1.5s infinite',
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 12, background: '#e5e7eb', borderRadius: 6, width: '60%', marginBottom: 8 }} />
                    <div style={{ height: 10, background: '#e5e7eb', borderRadius: 6, width: '40%' }} />
                  </div>
                </div>
              ) : user ? (
                /* ── Signed-in state ── */
                <div style={{
                  background: 'linear-gradient(135deg, #1f2937 0%, #111827 100%)',
                  borderRadius: 14, padding: '18px 16px', marginBottom: 20,
                  border: '1px solid rgba(245,158,11,0.25)',
                }}>
                  {/* Avatar + name row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                    <Avatar name={displayName} photoUrl={photoUrl} size={52} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{
                          fontWeight: 700, fontSize: 15, color: '#fff',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          maxWidth: 140,
                        }}>
                          {displayName}
                        </span>
                        {/* Online badge */}
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)',
                          borderRadius: 20, padding: '2px 8px', fontSize: 10, fontWeight: 600, color: '#10b981',
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', background: '#10b981',
                            boxShadow: '0 0 0 2px rgba(16,185,129,0.3)',
                          }} />
                          Online
                        </span>
                      </div>
                      {email && (
                        <p style={{
                          margin: '2px 0 0', fontSize: 11, color: '#9ca3af',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {email}
                        </p>
                      )}
                      {role && (
                        <span style={{
                          display: 'inline-block', marginTop: 4,
                          background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)',
                          borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 600, color: '#f59e0b',
                          textTransform: 'capitalize',
                        }}>
                          {role.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Full profile CTA */}
                  <Link
                    href="/user-dashboard"
                    onClick={handleOffCanvas}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: '#f59e0b', borderRadius: 8, padding: '9px 14px',
                      color: '#000', fontWeight: 700, fontSize: 13, textDecoration: 'none',
                      transition: 'background 0.2s',
                    }}
                  >
                    <span><i className="fas fa-user-circle" style={{ marginRight: 7 }} />View Full Profile</span>
                    <i className="fas fa-arrow-right" style={{ fontSize: 11 }} />
                  </Link>
                </div>
              ) : (
                /* ── Signed-out state ── */
                <div style={{
                  background: '#f8fafc', border: '1px solid #e5e7eb',
                  borderRadius: 14, padding: '18px 16px', marginBottom: 20,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: '50%',
                      background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 20, color: '#9ca3af',
                    }}>
                      <i className="fas fa-user" />
                    </div>
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#374151' }}>Not signed in</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: '#9ca3af' }}>Sign in to access your profile</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Link
                      href="/login"
                      onClick={handleOffCanvas}
                      style={{
                        flex: 1, textAlign: 'center', background: '#f59e0b',
                        borderRadius: 8, padding: '9px 0', color: '#000',
                        fontWeight: 700, fontSize: 13, textDecoration: 'none',
                      }}
                    >
                      Sign In
                    </Link>
                    <Link
                      href="/login?tab=signup"
                      onClick={handleOffCanvas}
                      style={{
                        flex: 1, textAlign: 'center', background: 'transparent',
                        border: '1.5px solid #d1d5db', borderRadius: 8, padding: '9px 0',
                        color: '#374151', fontWeight: 600, fontSize: 13, textDecoration: 'none',
                      }}
                    >
                      Register
                    </Link>
                  </div>
                </div>
              )}

              {/* ── Quick-access nav (signed in only) ─────────────── */}
              {user && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{
                    fontSize: 10, fontWeight: 700, color: '#9ca3af',
                    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
                  }}>
                    Quick Access
                  </p>
                  <nav>
                    {USER_LINKS.map(({ href, icon, label }) => (
                      <Link
                        key={href}
                        href={href}
                        onClick={handleOffCanvas}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 10px', borderRadius: 8, marginBottom: 2,
                          color: '#374151', textDecoration: 'none', fontSize: 13,
                          fontWeight: 500, transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f3f4f6'; e.currentTarget.style.color = '#f59e0b' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#374151' }}
                      >
                        <i className={icon} style={{ width: 16, textAlign: 'center', color: '#f59e0b', fontSize: 13 }} />
                        {label}
                      </Link>
                    ))}
                  </nav>
                </div>
              )}

              {/* ── Mobile nav (tablet breakpoint) ────────────────── */}
              <div className="d-md-block d-lg-none" style={{ marginBottom: 16 }}>
                <MobileMenu />
              </div>

              {/* ── Contact Info ─────────────────────────────────── */}
              <div className="offcanvas__contact">
                <h4>Contact Info</h4>
                <ul>
                  <li className="d-flex align-items-center">
                    <div className="offcanvas__contact-icon">
                      <i className="fal fa-map-marker-alt" />
                    </div>
                    <div className="offcanvas__contact-text">
                      <Link target="_blank" href="#">Lagos, Nigeria</Link>
                    </div>
                  </li>
                  <li className="d-flex align-items-center">
                    <div className="offcanvas__contact-icon mr-15">
                      <i className="fal fa-envelope" />
                    </div>
                    <div className="offcanvas__contact-text">
                      <a href="mailto:info@spotlightng.com">info@spotlightng.com</a>
                    </div>
                  </li>
                  <li className="d-flex align-items-center">
                    <div className="offcanvas__contact-icon mr-15">
                      <i className="fal fa-clock" />
                    </div>
                    <div className="offcanvas__contact-text">
                      <span>Mon–Fri, 09am – 05pm</span>
                    </div>
                  </li>
                </ul>

                {/* Bottom action: Apply or Sign Out */}
                <div className="header-button mt-4" style={{ display: 'flex', gap: 8 }}>
                  <Link href="/apply" onClick={handleOffCanvas} className="theme-btn text-center" style={{ flex: 1 }}>
                    <span>Apply Now <i className="fa-solid fa-arrow-right-long" /></span>
                  </Link>
                  {user && (
                    <button
                      onClick={handleSignOut}
                      disabled={signingOut}
                      style={{
                        background: 'transparent', border: '1.5px solid #dc2626',
                        borderRadius: 8, padding: '0 14px', cursor: 'pointer',
                        color: '#dc2626', fontSize: 12, fontWeight: 600,
                        whiteSpace: 'nowrap', opacity: signingOut ? 0.6 : 1,
                      }}
                    >
                      <i className="fas fa-sign-out-alt" style={{ marginRight: 5 }} />
                      {signingOut ? '…' : 'Sign Out'}
                    </button>
                  )}
                </div>

                <div className="social-icon d-flex align-items-center mt-3">
                  <Link href="#"><i className="fab fa-facebook-f" /></Link>
                  <Link href="#"><i className="fab fa-twitter" /></Link>
                  <Link href="#"><i className="fab fa-youtube" /></Link>
                  <Link href="#"><i className="fab fa-linkedin-in" /></Link>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
      <div
        className={`offcanvas__overlay ${isOffCanvas ? 'overlay-open' : ''}`}
        onClick={handleOffCanvas}
      />
    </>
  )
}
