import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const { access_token, refresh_token } = await req.json().catch(() => ({}));
  if (typeof access_token !== 'string' || typeof refresh_token !== 'string' || !access_token || !refresh_token) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  return new NextResponse(null, { status: 204 });
}
