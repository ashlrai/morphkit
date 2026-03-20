import { NextResponse } from 'next/server';

import type { AnalyticsData } from '@/types/analytics';

export async function GET() {
  const data: AnalyticsData = {
    revenue: 48250,
    activeUsers: 1284,
    conversionRate: 0.034,
    recentActivity: [
      { id: '1', type: 'purchase', user: 'John Doe', amount: 99.99, timestamp: new Date().toISOString() },
      { id: '2', type: 'signup', user: 'Jane Smith', amount: 0, timestamp: new Date().toISOString() },
    ],
  };

  return NextResponse.json(data);
}
