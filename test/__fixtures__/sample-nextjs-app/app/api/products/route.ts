import { NextResponse } from 'next/server';
import type { Product } from '@/types/product';

const mockProducts: Product[] = [
  {
    id: '1',
    name: 'Wireless Earbuds',
    description: 'High-quality wireless earbuds with noise cancellation',
    price: 79.99,
    imageUrl: '/images/earbuds.jpg',
    category: 'electronics',
    inStock: true,
    rating: 4.5,
    createdAt: new Date(),
  },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');

  let filtered = mockProducts;
  if (category) {
    filtered = mockProducts.filter((p) => p.category === category);
  }

  return NextResponse.json(filtered);
}

export async function POST(request: Request) {
  const body = await request.json();
  const newProduct: Product = {
    id: crypto.randomUUID(),
    ...body,
    createdAt: new Date(),
  };
  return NextResponse.json(newProduct, { status: 201 });
}
