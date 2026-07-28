# Pricing & Commission (core differentiator)

> The hybrid fare model is the product's defining mechanic. Every fare path is bounded by an admin **fare floor/ceiling** and a non-negotiable **driver-profitability floor**. All values are admin-configurable per city/zone — never hard-coded in the client.

## Pricing philosophy
Fair to driver · affordable to rider · transparent to both · configurable by city · fuel-cost sensitive · anti-exploitation · anti-offline-leakage · flexible for negotiation. Reward trips kept inside the app.

---

## Pricing Modes

| Mode | How it works |
|---|---|
| **Instant fare** | System calculates fare; rider accepts |
| **Offer fare** | Rider proposes a fare **within allowed range** |
| **Driver counteroffer** | Driver counters **within allowed range** |
| **Scheduled fare** | Rider locks an estimate for a future ride, with adjustment rules |
| **Bus fixed fare** | Operator sets fare; **admin approves** |
| **Parcel fare** | Distance × size × weight × speed × insurance × service level |
| **Mover quote** | Providers bid; rider selects an offer |
| **Towing quote** | Base callout fee + distance/service type |

### Hybrid ride negotiation loop
1. System suggests a fair price range.
2. Rider accepts instant price **or** makes an offer.
3. Driver accepts / rejects / counters **within admin-approved boundaries**.
4. Platform blocks exploitative low offers (driver-profit floor).
5. Platform protects driver earnings + prevents excessive surge abuse.

### Admin pricing levers
base fare · per-km · per-minute · minimum fare · **fare floor** · **fare ceiling** · negotiation range · fuel surcharge · surge multiplier · waiting fee · cancellation fee · bus fare · parcel fare · towing fee · mover quote rules · city/zone pricing.

---

## Commission Strategy

**Problem:** high commissions push drivers to reject trips, demand offline payment, negotiate outside the app, multi-app, and avoid short trips. Counter it with flexible models.

| Model | Mechanic |
|---|---|
| **Standard** | % per completed job |
| **Low-commission plan** | Reduced % for high-quality verified drivers |
| **Subscription plan** | Driver pays weekly/monthly platform access, keeps more fare |
| **Fleet plan** | Negotiated % by volume |
| **Performance-based** | Lower % for high rating, low cancellation, on-time pickup, no offline-trip attempts, good safety record, wallet payout |
| **Sponsored** | Brands subsidize rides/events |

All commission rules are admin-configurable. Commission changes are audited; sensitive changes follow approval workflow.

---

## Driver Economic Dashboard (must show)
gross earnings · Paymax fee · net earnings · fuel estimate · time online · acceptance rate · cancellation rate · bonus · wallet balance · payout history · commission tier · **how to reduce commission**. Goal: make economics transparent so drivers trust the platform and keep trips in-app.
