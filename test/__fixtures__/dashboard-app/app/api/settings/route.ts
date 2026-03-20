import { NextResponse } from 'next/server';

import type { UserSettings } from '@/types/analytics';

export async function GET() {
  const settings: UserSettings = {
    name: 'Demo User',
    email: 'demo@example.com',
    notifications: { email: true, push: false, sms: false },
    theme: 'system',
  };

  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  const body: UserSettings = await request.json();
  return NextResponse.json(body);
}
