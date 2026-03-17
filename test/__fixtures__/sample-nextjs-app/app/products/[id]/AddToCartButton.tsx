'use client';

import { useState } from 'react';
import type { Product } from '@/types/product';
import { useCartStore } from '@/lib/store';

export function AddToCartButton({ product }: { product: Product }) {
  const [added, setAdded] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  function handleAdd() {
    addItem(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  if (!product.inStock) return null;

  return (
    <button
      onClick={handleAdd}
      disabled={added}
      className={`w-full rounded-lg py-3 text-lg font-semibold text-white transition-colors ${
        added ? 'bg-green-500' : 'bg-brand hover:bg-indigo-600'
      }`}
    >
      {added ? '✓ Added to Cart' : 'Add to Cart'}
    </button>
  );
}
