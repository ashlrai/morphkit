import type { Product } from '@/types/product';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.example.com';

export async function fetchProducts(category?: string): Promise<Product[]> {
  const url = new URL(`${API_BASE}/products`);
  if (category) url.searchParams.set('category', category);
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
}

export async function fetchProduct(id: string): Promise<Product> {
  const res = await fetch(`${API_BASE}/products/${id}`);
  if (!res.ok) throw new Error('Product not found');
  return res.json();
}

export async function searchProducts(query: string): Promise<Product[]> {
  const res = await fetch(`${API_BASE}/products/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}
