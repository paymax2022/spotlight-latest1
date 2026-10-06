import { NextRequest, NextResponse } from 'next/server';
import { featureFlags } from '@/src/lib/feature-flags';

export async function POST(request: NextRequest) {
  try {
    // Flag gate FIRST — the whole /api/v1/doctor/* module is unmounted in Go
    // when FEATURE_DOCTOR_ENABLED is off. Answering validation errors here
    // while every sibling 404s leaks that this leaf exists (error-shape
    // enumeration) and invites traffic against a dead upstream.
    if (!featureFlags.doctor()) {
      return NextResponse.json(
        { error: 'This service is not available.' },
        { status: 503 }
      );
    }
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const { bank_code, account_number, bank_name } = body;

    if (!bank_code || !account_number) {
      return NextResponse.json(
        { error: 'Missing bank_code or account_number' },
        { status: 400 }
      );
    }

    if (account_number.length !== 10 || !/^\d+$/.test(account_number)) {
      return NextResponse.json(
        { error: 'Account number must be 10 digits' },
        { status: 400 }
      );
    }

    const token = request.cookies.get('access_token')?.value;
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const response = await fetch(
      `${backendUrl}/api/v1/doctor/profile/bank-account/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          bank_code,
          account_number,
          bank_name,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Verification failed' }));
      return NextResponse.json(
        errorData,
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    console.error('Bank account verification error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
