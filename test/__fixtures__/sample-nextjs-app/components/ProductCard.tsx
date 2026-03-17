'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { Product } from '@/types/product';
import { useCartStore } from '@/lib/store';

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const addItem = useCartStore((s) => s.addItem);

  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      <Link href={`/products/${product.id}`}>
        <div className="relative aspect-square overflow-hidden rounded-md">
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            className="object-cover"
          />
        </div>
      </Link>
      <div className="mt-3 space-y-1">
        <h3 className="font-semibold text-gray-900 line-clamp-1">{product.name}</h3>
        <p className="text-sm text-gray-500 line-clamp-2">{product.description}</p>
        <div className="flex items-center justify-between pt-2">
          <span className="text-lg font-bold text-brand">${product.price.toFixed(2)}</span>
          {product.inStock ? (
            <button
              onClick={() => addItem(product)}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-600"
            >
              Add to Cart
            </button>
          ) : (
            <span className="text-sm text-gray-400">Out of Stock</span>
          )}
        </div>
        {product.rating && (
          <div className="flex items-center gap-1 text-sm text-yellow-500">
            {'★'.repeat(Math.round(product.rating))}
            <span className="text-gray-400">({product.rating.toFixed(1)})</span>
          </div>
        )}
      </div>
    </div>
  );
}
