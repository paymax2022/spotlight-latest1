import { legacyUtilityValidation, firstProductId } from '../../_utils';

export async function POST(request: Request) {
  return legacyUtilityValidation(request, {
    category: 'cable_tv',
    billerCode: (body) => String(body.providerCode || body.provider_code || ''),
    customerReference: (body) => String(body.smartCardNumber || body.smart_card_number || ''),
    productId: (body, billerId) => {
      const packageId = String(body.packageId || body.package_id || '');
      return packageId || firstProductId(billerId);
    },
  });
}
