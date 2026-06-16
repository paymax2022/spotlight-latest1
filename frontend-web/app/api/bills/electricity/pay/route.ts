import { legacyUtilityPurchase, firstProductId } from '../../_utils';

export async function POST(request: Request) {
  return legacyUtilityPurchase(request, {
    category: 'electricity',
    billerCode: (body) => String(body.discoCode || body.disco_code || ''),
    customerReference: (body) => String(body.meterNumber || body.meter_number || ''),
    productId: (_body, billerId) => firstProductId(billerId, 'variable'),
    amountKobo: (body) => Math.round(Number(body.amount || 0) * 100),
    metadata: (body) => ({
      meter_type: body.meterType || body.meter_type || 'PREPAID',
      customer_phone: String(body.customerPhone || body.customer_phone || ''),
      customer_email: body.customerEmail || body.customer_email || null,
      payment_method: body.paymentMethod || body.payment_method || 'WALLET',
      legacy_route: '/api/bills/electricity/pay',
    }),
  });
}
