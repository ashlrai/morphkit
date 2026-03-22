'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Research {
  id: string;
  query: string;
  depth: string;
  content: string;
  createdAt: string;
  status: 'completed' | 'pending' | 'failed';
}

interface UserProfile {
  id: string;
  email: string;
  name: string;
  balance: number;
  plan: 'free' | 'pro' | 'enterprise';
}

export default function DashboardPage() {
  const [research, setResearch] = useState<Research[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: researchData } = await supabase
      .from('research_queries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (researchData) setResearch(researchData);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (profileData) setProfile(profileData);
    }
  }

  async function handleSearch() {
    setIsLoading(true);
    const response = await fetch('/api/research', {
      method: 'POST',
      body: JSON.stringify({ query, depth: 'quick' }),
    });
    // SSE streaming handled by EventSource
    setIsLoading(false);
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-white">Dashboard</h1>
        {profile && (
          <div className="bg-surface rounded-xl p-4">
            <p className="text-gray-400">Balance: ${profile.balance}</p>
            <p className="text-gray-400">Plan: {profile.plan}</p>
          </div>
        )}
        <input
          className="w-full p-4 bg-surface rounded-lg text-white"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything..."
        />
        <button onClick={handleSearch} disabled={isLoading}>
          {isLoading ? 'Researching...' : 'Search'}
        </button>
        <div className="space-y-4">
          {research.map((item) => (
            <div key={item.id} className="bg-surface rounded-lg p-4">
              <h3 className="font-semibold text-white">{item.query}</h3>
              <p className="text-gray-500 text-sm">{item.depth} | {item.status}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
