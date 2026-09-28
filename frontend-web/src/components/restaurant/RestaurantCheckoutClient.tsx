'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getRestaurant, initiatePaystackOrder, placeOrder, quoteDelivery, RestaurantApiError } from '@/src/lib/restaurant/api';
import { cartTotalKobo, loadLocalCart, saveLocalCart } from '@/src/lib/restaurant/cart';
import { formatNaira } from '@/src/lib/restaurant/format';
import type { Cart, DeliveryQuote, Restaurant } from '@/src/types/restaurant';

export default function RestaurantCheckoutClient() {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState<'wallet' | 'card' | null>(null);
  const [message, setMessage] = useState('');
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    const local = loadLocalCart();
    setCart(local);
    if (!local) { setLoading(false); return; }
    (async () => {
      try {
        const detail = await getRestaurant(local.restaurant_id);
        if (!detail) { setAuthError(true); return; }
        setRestaurant(detail.restaurant);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Unable to load restaurant.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const subtotal = cartTotalKobo(cart);
  const packagingFee = restaurant?.packaging_fee_kobo ?? 0;
  const deliveryFee = quote?.delivery_fee_kobo;
  const total = subtotal + packagingFee + (deliveryFee ?? 0);
  const belowMin = Boolean(restaurant && subtotal < restaurant.min_order_kobo);

  async function requestLocationEstimate() {
    if (!restaurant || typeof navigator === 'undefined' || !navigator.geolocation) {
      setMessage('Location access is not available in this browser.');
      return;
    }
    setQuoting(true);
    setMessage('');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoords({ lat, lng });
        try {
          const result = await quoteDelivery(restaurant.id, lat, lng);
          setQuote(result);
        } catch (e) {
          setMessage(e instanceof Error ? e.message : 'Unable to estimate delivery fee.');
        } finally {
          setQuoting(false);
        }
      },
      () => {
        setQuoting(false);
        setMessage('Location access was denied. You can still place your order — delivery fee will be estimated by the restaurant.');
      },
      { timeout: 10_000 },
    );
  }

  async function submit(method: 'wallet' | 'card') {
    if (!cart || !restaurant) return;
    if (!address.trim()) { setMessage('Please enter a delivery address.'); return; }
    if (belowMin) { setMessage(`Add ${formatNaira(restaurant.min_order_kobo - subtotal)} more to meet the minimum order.`); return; }
    setBusy(method);
    setMessage('');
    try {
      const body = {
        items: cart.lines.map((line) => ({ menu_item_id: line.menu_item_id, quantity: line.quantity })),
        delivery_address: address.trim(),
        delivery_location: coords ?? undefined,
        package_count: 1,
      };
      if (method === 'wallet') {
        const order = await placeOrder(restaurant.id, body);
        if (!order) { setAuthError(true); return; }
        saveLocalCart(null);
        router.push(`/restaurant/orders/${order.id}`);
        return;
      }
      const intent = await initiatePaystackOrder(restaurant.id, {
        ...body,
        callback_url: typeof window !== 'undefined' ? `${window.location.origin}/restaurant/paystack` : undefined,
      });
      if (!intent) { setAuthError(true); return; }
      saveLocalCart(null);
      window.location.href = intent.authorizationUrl;
    } catch (e) {
      if (e instanceof RestaurantApiError) {
        setMessage(e.message);
      } else {
        setMessage(method === 'wallet' ? 'Payment failed.' : 'Unable to start card payment.');
      }
    } finally {
      setBusy(null);
    }
  }

  if (!loading && authError) {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🔒</div>
        <h3 style={{ marginBottom: 8 }}>Sign in to check out</h3>
        <Link href="/login?next=/restaurant/checkout" className="theme-btn">Sign In</Link>
      </div>
    );
  }

  if (loading) {
    return <div style={{ height: 240, background: 'rgba(0,0,0,0.06)', borderRadius: 10 }} />;
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ fontSize: 32, marginBottom: 8 }}>🛒</p>
        <h4>Your cart is empty</h4>
        <Link href="/restaurant" className="btn-primary py-2.5 px-4 text-[11px]" style={{ marginTop: 12, display: 'inline-block' }}>
          Browse Restaurants
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4">
      <div className="glass-card rounded-md p-4 md:p-5">
        <p className="section-label mb-2">Checkout</p>
        <h1 className="font-display text-3xl text-foreground" style={{ marginBottom: 16 }}>{cart.restaurant_name}</h1>

        <label className="d-block" style={{ marginBottom: 12 }}>
          <span className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">Delivery Address</span>
          <textarea
            className="form-input mt-1"
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street address, landmark, city"
          />
        </label>

        <button type="button" className="btn-outline py-2 px-3 text-[11px]" onClick={() => void requestLocationEstimate()} disabled={quoting}>
          {quoting ? 'Estimating…' : '📍 Use My Location for Delivery Estimate'}
        </button>

        {restaurant && !restaurant.is_open && (
          <p style={{ marginTop: 12, color: '#dc2626', fontSize: 13 }}>This restaurant is currently closed and may not accept your order right away.</p>
        )}

        {belowMin && restaurant && (
          <p style={{ marginTop: 12, color: '#d97706', fontSize: 13, fontWeight: 600 }}>
            Add {formatNaira(restaurant.min_order_kobo - subtotal)} more to meet the {formatNaira(restaurant.min_order_kobo)} minimum order.
          </p>
        )}

        <div style={{ marginTop: 20 }}>
          <h5 style={{ fontWeight: 700, marginBottom: 10 }}>Order Summary</h5>
          {cart.lines.map((line) => (
            <div key={line.menu_item_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
              <span>{line.quantity}× {line.name}</span>
              <span>{formatNaira(line.price_kobo * line.quantity)}</span>
            </div>
          ))}
        </div>
      </div>

      <aside>
        <div className="glass-card rounded-md p-4" style={{ position: 'sticky', top: 20 }}>
          <h5 style={{ fontWeight: 700, marginBottom: 10 }}>Total</h5>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
            <span>Subtotal</span><span>{formatNaira(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
            <span>Packaging</span><span>{formatNaira(packagingFee)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
            <span>Delivery</span>
            <span>{deliveryFee !== undefined ? formatNaira(deliveryFee) : <em style={{ color: 'var(--foreground-dim)', fontStyle: 'normal', fontSize: 11 }}>estimate incomplete</em>}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 8 }}>
            <span>Total{deliveryFee === undefined ? '*' : ''}</span><span>{formatNaira(total)}</span>
          </div>
          {deliveryFee === undefined && (
            <p style={{ fontSize: 11, color: 'var(--foreground-dim)', marginTop: 4 }}>*Delivery fee will be finalized by the restaurant if no location estimate is provided.</p>
          )}

          {message && <p className="form-error" style={{ marginTop: 12 }}>{message}</p>}

          <button
            type="button"
            className="btn-primary py-3 px-4 text-[12px]"
            style={{ width: '100%', marginTop: 14 }}
            disabled={busy !== null}
            onClick={() => void submit('wallet')}
          >
            {busy === 'wallet' ? 'Processing…' : '🏦 Pay From Wallet'}
          </button>
          <button
            type="button"
            className="btn-outline py-3 px-4 text-[12px]"
            style={{ width: '100%', marginTop: 10 }}
            disabled={busy !== null}
            onClick={() => void submit('card')}
          >
            {busy === 'card' ? 'Processing…' : '💳 Pay With Card'}
          </button>
        </div>
      </aside>
    </div>
  );
}
