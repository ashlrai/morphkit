import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { username: string } },
) {
  return NextResponse.json({ id: '1', username: params.username, displayName: 'Demo User' });
}
