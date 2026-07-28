import { NextResponse } from 'next/server';
import { ApiError, handleApiError } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { getResidentContext, genNumericCode, toDbCodeType } from '@/src/server/visitor/visitor.service';

// POST /api/v1/visitor/codes/import — bulk-create access codes from a CSV file.
// CSV columns (header row required): visitor_name,code_type,valid_from,valid_until,unit_label
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const supabase = createAdminClient();
    const ctx = await getResidentContext(supabase, user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') throw new ApiError('CSV file is required', 400);

    const text = await (file as File).text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new ApiError('CSV must have a header row and at least one data row', 400);

    // Parse header.
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idx = {
      visitor_name: headers.indexOf('visitor_name'),
      code_type: headers.indexOf('code_type'),
      valid_from: headers.indexOf('valid_from'),
      valid_until: headers.indexOf('valid_until'),
      unit_label: headers.indexOf('unit_label'),
    };
    if (idx.visitor_name === -1 || idx.valid_from === -1 || idx.valid_until === -1) {
      throw new ApiError('CSV must have visitor_name, valid_from, valid_until columns', 400);
    }

    const inserts = lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim());
      const visitorName = cols[idx.visitor_name] ?? '';
      const codeType = idx.code_type !== -1 ? cols[idx.code_type] : 'one_time';
      const validFrom = cols[idx.valid_from] ?? '';
      const validUntil = cols[idx.valid_until] ?? '';
      return {
        estate_id: ctx.estateId,
        issued_by: user.id,
        visitor_name: visitorName,
        code_type: toDbCodeType(codeType),
        numeric_code: genNumericCode(),
        valid_from: validFrom,
        valid_until: validUntil,
        max_uses: 1,
        status: 'active',
        usage_mode: 'one_time',
        party_size: 1,
      };
    }).filter((r) => r.visitor_name && r.valid_from && r.valid_until);

    if (inserts.length === 0) throw new ApiError('No valid rows found in CSV', 400);

    const { data: rows, error } = await supabase
      .from('visitor_access_codes')
      .insert(inserts)
      .select('id');
    if (error) throw error;

    return NextResponse.json({ imported: (rows ?? []).length }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to import access codes');
  }
}
