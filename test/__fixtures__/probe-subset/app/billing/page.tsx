'use client';

import { useState } from 'react';

interface Transaction {
  id: string;
  type: 'deposit' | 'usage' | 'refund';
  amount: number;
  description: string;
  createdAt: string;
}

export default function BillingPage() {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  async function handleTopUp(amount: number) {
    const response = await fetch('/api/billing/topup', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    const { url } = await response.json();
    window.location.href = url;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Billing</h1>
      <div className="bg-surface rounded-xl p-6">
        <p className="text-4xl font-bold">${balance.toFixed(2)}</p>
        <p className="text-gray-500">Current balance</p>
      </div>
      <div className="flex gap-4">
        <button onClick={() => handleTopUp(10)} className="bg-primary text-white px-4 py-2 rounded-lg">$10</button>
        <button onClick={() => handleTopUp(25)} className="bg-primary text-white px-4 py-2 rounded-lg">$25</button>
        <button onClick={() => handleTopUp(50)} className="bg-primary text-white px-4 py-2 rounded-lg">$50</button>
      </div>
      <div className="space-y-2">
        {transactions.map((tx) => (
          <div key={tx.id} className="flex justify-between p-3 bg-surface rounded-lg">
            <span>{tx.description}</span>
            <span className={tx.type === 'deposit' ? 'text-green-500' : 'text-red-500'}>
              {tx.type === 'deposit' ? '+' : '-'}${tx.amount.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
