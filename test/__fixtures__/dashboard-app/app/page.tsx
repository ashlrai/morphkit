'use client';

import { useState, useEffect } from 'react';
import type { AnalyticsData } from '@/types/analytics';
import { fetchAnalytics } from '@/lib/api';

export default function DashboardPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function loadAnalytics() {
    setIsLoading(true);
    try {
      const analytics = await fetchAnalytics();
      setData(analytics);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-gray-900">Overview</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Revenue</p>
          <p className="text-2xl font-bold text-gray-900">${data.revenue.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Active Users</p>
          <p className="text-2xl font-bold text-gray-900">{data.activeUsers.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-white p-6">
          <p className="text-sm text-gray-500">Conversion Rate</p>
          <p className="text-2xl font-bold text-gray-900">{(data.conversionRate * 100).toFixed(1)}%</p>
        </div>
      </div>

      <section>
        <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
        <div className="rounded-lg border bg-white divide-y">
          {data.recentActivity.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  item.type === 'purchase' ? 'bg-green-500' :
                  item.type === 'signup' ? 'bg-blue-500' : 'bg-red-500'
                }`} />
                <div>
                  <p className="font-medium text-gray-900">{item.user}</p>
                  <p className="text-sm text-gray-500 capitalize">{item.type}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium text-gray-900">${item.amount.toFixed(2)}</p>
                <p className="text-sm text-gray-500">{new Date(item.timestamp).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
