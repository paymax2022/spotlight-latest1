import { legacyUtilityPurchase } from '../../_utils';

export async function POST(request: Request) {
  return legacyUtilityPurchase(request, {
    category: 'cable_tv',
    billerCode: (body) => String(body.providerCode || body.provider_code || ''),
    customerReference: (body) => String(body.smartCardNumber || body.smart_card_number || ''),
    productId: (body) => String(body.packageId || body.package_id || ''),
    metadata: (body) => ({
      customer_phone: String(body.customerPhone || body.customer_phone || ''),
      customer_email: body.customerEmail || body.customer_email || null,
      payment_method: body.paymentMethod || body.payment_method || 'WALLET',
      legacy_route: '/api/bills/cable/pay',
    }),
  });
}
