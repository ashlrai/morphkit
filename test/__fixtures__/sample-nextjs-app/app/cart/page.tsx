'use client';

import { useCartStore } from '@/lib/store';
import Image from 'next/image';
import Link from 'next/link';

export default function CartPage() {
  const { items, total, removeItem, updateQuantity, clearCart } = useCartStore();

  if (items.length === 0) {
    return (
      <div className="text-center py-16 space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Your Cart is Empty</h1>
        <p className="text-gray-500">Add some products to get started!</p>
        <Link href="/products" className="inline-block rounded-md bg-brand px-6 py-3 text-white hover:bg-indigo-600">
          Browse Products
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Shopping Cart</h1>
        <button onClick={clearCart} className="text-sm text-red-600 hover:text-red-800">
          Clear Cart
        </button>
      </div>

      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.product.id} className="flex items-center gap-4 rounded-lg border bg-white p-4">
            <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-md">
              <Image src={item.product.imageUrl} alt={item.product.name} fill className="object-cover" />
            </div>

            <div className="flex-1 min-w-0">
              <Link href={`/products/${item.product.id}`} className="font-semibold text-gray-900 hover:text-brand">
                {item.product.name}
              </Link>
              <p className="text-sm text-gray-500">${item.product.price.toFixed(2)} each</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => updateQuantity(item.product.id, Math.max(1, item.quantity - 1))}
                className="rounded border px-2 py-1 text-sm"
              >
                −
              </button>
              <span className="w-8 text-center">{item.quantity}</span>
              <button
                onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                className="rounded border px-2 py-1 text-sm"
              >
                +
              </button>
            </div>

            <span className="font-semibold text-gray-900 w-24 text-right">
              ${(item.product.price * item.quantity).toFixed(2)}
            </span>

            <button
              onClick={() => removeItem(item.product.id)}
              className="text-red-500 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="border-t pt-6">
        <div className="flex items-center justify-between text-xl font-bold">
          <span>Total</span>
          <span>${total.toFixed(2)}</span>
        </div>
        <button className="mt-4 w-full rounded-lg bg-brand py-3 text-lg font-semibold text-white hover:bg-indigo-600">
          Checkout
        </button>
      </div>
    </div>
  );
}
