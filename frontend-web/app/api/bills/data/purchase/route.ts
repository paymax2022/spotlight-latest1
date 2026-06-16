import { legacyUtilityPurchase } from '../../_utils';

export async function POST(request: Request) {
  return legacyUtilityPurchase(request, {
    category: 'data',
    billerCode: (body) => String(body.networkCode || body.network_code || ''),
    customerReference: (body) => String(body.phoneNumber || body.phone_number || ''),
    productId: (body) => String(body.planId || body.plan_id || ''),
    metadata: (body) => ({
      customer_phone: String(body.phoneNumber || body.phone_number || ''),
      payment_method: body.paymentMethod || body.payment_method || 'WALLET',
      legacy_route: '/api/bills/data/purchase',
    }),
  });
}
