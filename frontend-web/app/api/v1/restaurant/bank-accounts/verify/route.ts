import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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

    // Get the user's access token from cookies or headers
    const token = request.cookies.get('access_token')?.value;
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Call the Go backend API
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    const response = await fetch(
      `${backendUrl}/api/v1/restaurant/bank-accounts/verify`,
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
