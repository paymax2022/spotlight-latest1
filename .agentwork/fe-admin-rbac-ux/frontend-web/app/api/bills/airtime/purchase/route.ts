import { legacyUtilityPurchase, firstProductId } from '../../_utils';

export async function POST(request: Request) {
  return legacyUtilityPurchase(request, {
    category: 'airtime',
    billerCode: (body) => String(body.networkCode || body.network_code || ''),
    customerReference: (body) => String(body.phoneNumber || body.phone_number || ''),
    productId: (_body, billerId) => firstProductId(billerId, 'variable'),
    amountKobo: (body) => Math.round(Number(body.amount || 0) * 100),
    metadata: (body) => ({
      customer_phone: String(body.phoneNumber || body.phone_number || ''),
      payment_method: body.paymentMethod || body.payment_method || 'WALLET',
      legacy_route: '/api/bills/airtime/purchase',
    }),
  });
}
