import { legacyUtilityValidation, firstProductId } from '../../_utils';

export async function POST(request: Request) {
  return legacyUtilityValidation(request, {
    category: 'electricity',
    billerCode: (body) => String(body.discoCode || body.disco_code || ''),
    customerReference: (body) => String(body.meterNumber || body.meter_number || ''),
    productId: (_body, billerId) => firstProductId(billerId, 'variable'),
  });
}
