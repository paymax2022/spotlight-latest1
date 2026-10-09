'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getRestaurant, toggleLike, cartItemCount, cartTotalKobo, fetchServerCart, loadLocalCart, saveLocalCart, syncCartToServer, formatNaira } from '@/src/lib/restaurant';
import type { Cart, MenuItem, RestaurantDetail } from '@/src/types/restaurant';

export default function RestaurantDetailClient({ restaurantId }: { restaurantId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<RestaurantDetail | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState(false);
  const [liking, setLiking] = useState(false);
  const [switchNotice, setSwitchNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [data, local] = await Promise.all([getRestaurant(restaurantId), Promise.resolve(loadLocalCart())]);
        if (cancelled) return;
        if (!data) { setAuthError(true); return; }
        setDetail(data);
        let effectiveCart = local;
        if (!effectiveCart) {
          effectiveCart = await fetchServerCart();
        }
        setCart(effectiveCart);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load restaurant.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [restaurantId]);

  const restaurant = detail?.restaurant;
  const cartTotal = useMemo(() => cartTotalKobo(cart), [cart]);
  const cartCount = useMemo(() => cartItemCount(cart), [cart]);
  const cartBelongsHere = !cart || cart.restaurant_id === restaurantId;

  function persist(next: Cart | null) {
    setCart(next);
    saveLocalCart(next);
    void syncCartToServer(next);
  }

  function addItem(item: MenuItem) {
    if (!restaurant) return;
    if (cart && cart.restaurant_id !== restaurantId) {
      setSwitchNotice(true);
      return;
    }
    const base: Cart = cart ?? { restaurant_id: restaurantId, restaurant_name: restaurant.name, lines: [] };
    const existing = base.lines.find((line) => line.menu_item_id === item.id);
    const lines = existing
      ? base.lines.map((line) => (line.menu_item_id === item.id ? { ...line, quantity: line.quantity + 1 } : line))
      : [...base.lines, { menu_item_id: item.id, name: item.name, price_kobo: item.price_kobo, quantity: 1 }];
    persist({ ...base, lines });
  }

  function changeQty(menuItemId: string, delta: number) {
    if (!cart) return;
    const lines = cart.lines
      .map((line) => (line.menu_item_id === menuItemId ? { ...line, quantity: line.quantity + delta } : line))
      .filter((line) => line.quantity > 0);
    persist(lines.length ? { ...cart, lines } : null);
  }

  function startFreshCart() {
    if (!restaurant) return;
    persist({ restaurant_id: restaurantId, restaurant_name: restaurant.name, lines: [] });
    setSwitchNotice(false);
  }

  async function onToggleLike() {
    if (!restaurant) return;
    setLiking(true);
    try {
      const result = await toggleLike(restaurant.id, Boolean(restaurant.liked));
      if (result) {
        setDetail((prev) => prev ? {
          ...prev,
          restaurant: { ...prev.restaurant, liked: result.liked, like_count: prev.restaurant.like_count + (result.liked ? 1 : -1) },
        } : prev);
      }
    } catch {
      // Non-critical — leave the like state as-is on failure.
    } finally {
      setLiking(false);
    }
  }

  if (!loading && authError) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
        <h3 style={{ marginBottom: 8 }}>Sign in to order food</h3>
        <Link href={`/login?next=/restaurant/${restaurantId}`} className="theme-btn">Sign In</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[100, 300, 200].map((h, i) => <div key={i} style={{ height: h, background: 'rgba(0,0,0,0.06)', borderRadius: 10 }} />)}
      </div>
    );
  }

  if (error || !detail || !restaurant) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: '#dc2626' }}>{error || 'Restaurant not found.'}</p>
        <Link href="/restaurant" className="btn-outline py-2.5 px-4 text-[11px]">Back to Restaurants</Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="glass-card rounded-md p-4 md:p-5">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p className="section-label mb-2">{restaurant.cuisine || 'Restaurant'}</p>
            <h1 className="font-display text-3xl text-foreground" style={{ marginBottom: 4 }}>{restaurant.name}</h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--foreground-muted)' }}>{restaurant.address}</p>
          </div>
          <button
            type="button"
            onClick={() => void onToggleLike()}
            disabled={liking}
            className="btn-outline py-2 px-3 text-[11px]"
          >
            {restaurant.liked ? '❤️ Liked' : '🤍 Like'} ({restaurant.like_count})
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14, fontSize: 13, color: 'var(--foreground-muted)' }}>
          <span>⭐ {restaurant.rating?.toFixed(1) ?? '5.0'}</span>
          <span>Min order {formatNaira(restaurant.min_order_kobo)}</span>
          <span>Packaging {formatNaira(restaurant.packaging_fee_kobo)}/pack</span>
          {restaurant.prep_time_minutes ? <span>~{restaurant.prep_time_minutes} min prep</span> : null}
          {!restaurant.is_open && <span style={{ color: '#dc2626', fontWeight: 700 }}>Currently Closed</span>}
        </div>

        {switchNotice && (
          <div style={{ marginTop: 14, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
            Your cart has items from <strong>{cart?.restaurant_name}</strong>. Adding from a different restaurant will start a new cart.
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button type="button" className="btn-primary py-1.5 px-3 text-[11px]" onClick={startFreshCart}>Start New Cart</button>
              <button type="button" className="btn-outline py-1.5 px-3 text-[11px]" onClick={() => setSwitchNotice(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {detail.categories.length === 0 && (
            <p style={{ color: 'var(--foreground-muted)' }}>This restaurant hasn&apos;t added any menu items yet.</p>
          )}
          {detail.categories.map((category) => (
            <div key={category.id}>
              <h5 style={{ fontWeight: 700, marginBottom: 10 }}>{category.name}</h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
                {category.items.filter((item) => item.is_available).map((item) => {
                  const inCartQty = cartBelongsHere ? (cart?.lines.find((l) => l.menu_item_id === item.id)?.quantity ?? 0) : 0;
                  return (
                    <div key={item.id} className="glass-card rounded-md p-3" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{item.name}</p>
                        {item.description && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--foreground-muted)' }}>{item.description}</p>}
                        <p style={{ margin: '4px 0 0', fontWeight: 700 }}>{formatNaira(item.price_kobo)}</p>
                      </div>
                      {inCartQty > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button type="button" className="btn-outline py-1 px-2 text-[11px]" onClick={() => changeQty(item.id, -1)}>−</button>
                          <span style={{ fontWeight: 700 }}>{inCartQty}</span>
                          <button type="button" className="btn-outline py-1 px-2 text-[11px]" onClick={() => changeQty(item.id, 1)}>+</button>
                        </div>
                      ) : (
                        <button type="button" className="btn-primary py-1.5 px-3 text-[11px]" onClick={() => addItem(item)}>
                          Add to Cart
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <aside>
        <div className="glass-card rounded-md p-4" style={{ position: 'sticky', top: 20 }}>
          <h5 style={{ fontWeight: 700, marginBottom: 10 }}>Your Cart</h5>
          {!cart || cart.lines.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--foreground-muted)' }}>Your cart is empty. Add items from the menu.</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cart.lines.map((line) => (
                  <div key={line.menu_item_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{line.quantity}× {line.name}</span>
                    <span>{formatNaira(line.price_kobo * line.quantity)}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>Subtotal ({cartCount} item{cartCount !== 1 ? 's' : ''})</span>
                <span>{formatNaira(cartTotal)}</span>
              </div>
              <button
                type="button"
                className="btn-primary py-2.5 px-4 text-[11px]"
                style={{ width: '100%', marginTop: 12 }}
                onClick={() => router.push('/restaurant/checkout')}
              >
                Go to Checkout
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
