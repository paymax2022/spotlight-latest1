import { NextRequest, NextResponse } from 'next/server';

type InquiryPayload = {
  serviceName?: string;
  formType?: string;
  consent?: boolean;
  fields?: Record<string, unknown>;
};

function isNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasBasicEmail(value: unknown) {
  return typeof value === 'string' && /.+@.+\..+/.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as InquiryPayload;

    if (!isNonEmptyString(body.serviceName) || !isNonEmptyString(body.formType)) {
      return NextResponse.json(
        { ok: false, message: 'Missing service or form metadata.' },
        { status: 400 }
      );
    }

    if (body.consent !== true) {
      return NextResponse.json(
        { ok: false, message: 'Consent is required.' },
        { status: 400 }
      );
    }

    const fields = body.fields || {};
    const email = fields.email;

    if (email && !hasBasicEmail(email)) {
      return NextResponse.json(
        { ok: false, message: 'Invalid email format.' },
        { status: 400 }
      );
    }

    // TODO: Integrate with CRM/email workflow (e.g. HubSpot, Notion, Supabase, or SMTP transport).
    // For now, we acknowledge receipt so frontend flows are fully functional.
    return NextResponse.json({
      ok: true,
      message: 'Inquiry received successfully.',
      data: {
        receivedAt: new Date().toISOString(),
        serviceName: body.serviceName,
        formType: body.formType,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Invalid request payload.' },
      { status: 400 }
    );
  }
}
