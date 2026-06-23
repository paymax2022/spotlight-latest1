# Bills Payment Screen Matrix

Date: 2026-06-14

| Required screen/state | Status | Route/path | Notes |
| --- | --- | --- | --- |
| Bills / Payments landing screen | Exists | `/services/bills` | Service categories and recent billers present. History icon has no visible action. |
| Airtime purchase screen | Exists | `/services/airtime` | Provider, phone, amount, review modal, API error display. |
| Data purchase screen | Exists | `/services/data` | Provider, bundle load, phone, review modal. |
| Internet service provider screen | Partial | `/services/data` | Combined into Data screen; no separate ISP account-ID UX beyond phone/router placeholder. |
| Electricity payment screen | Exists | `/services/electricity` | Combined prepaid/postpaid flow. |
| Electricity provider/disco selection | Exists | `/services/electricity` | Current mocked/expected list includes IKEDC, EKEDC, AEDC, PHED. Missing remaining discos from QA list unless API supplies them. |
| Meter validation screen | Partial | `/services/electricity` | Inline validation state, not a separate screen. |
| Cable TV screen | Exists | `/services/cable-tv` | Provider, IUC, bouquet, review modal. |
| Cable provider selection | Exists | `/services/cable-tv` | Inline provider grid. |
| Bouquet/package selection | Exists | `/services/cable-tv` | Loads after provider selection. |
| Smart card/IUC validation | Partial | `/services/cable-tv` | Inline validation state, not a separate screen. |
| Transaction review/confirmation | Partial | Modal in payment screens | Shows core data but no PIN entry, wallet balance, fee breakdown, provider cost, margin, or VAT. |
| Payment PIN authorization | Missing | None | Critical security gap. |
| Transaction processing screen | Partial | Button loading only | No dedicated processing route or resumable state. |
| Transaction success screen | Exists | `/services/receipt/[id]` | Receipt banner supports success. |
| Transaction failed screen | Exists | `/services/receipt/[id]` | Receipt banner supports failed if API returns it. |
| Transaction pending screen | Exists | `/services/receipt/[id]` | Receipt banner supports pending/processing. |
| Receipt screen | Exists | `/services/receipt/[id]` | Share action present. No download. Token displayed for prepaid electricity if API returns token. |
| Transaction history screen | Exists | `/services/transactions` | Filter pills and list present. |
| Transaction detail screen | Exists | `/services/transactions/[id]` | Detail and retry support exist. |
| Saved beneficiaries screen | Missing | None | No add/manage beneficiary UX. |
| Add/manage beneficiary screen | Missing | None | API/backend may exist separately; mobile UI absent. |
| Provider unavailable/failover state | Missing | None | Generic API errors only; no primary/backup provider state. |
| Insufficient wallet balance screen | Partial | Inline error | No dedicated low-balance screen or top-up CTA in flow. |

## Navigation Issues

- Bills landing history icon is decorative unless wired elsewhere; tests use `/services/transactions` directly.
- Education route still uses static `PaymentScreen` with a no-op primary action.
- Payment review is a modal rather than a route, so refresh/back behavior during confirmation is fragile.
