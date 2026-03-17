import { fetchProduct } from '@/lib/api';
import { AddToCartButton } from './AddToCartButton';
import Image from 'next/image';
import Link from 'next/link';

interface ProductPageProps {
  params: { id: string };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const product = await fetchProduct(params.id);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="relative aspect-square overflow-hidden rounded-xl">
        <Image src={product.imageUrl} alt={product.name} fill className="object-cover" />
      </div>

      <div className="space-y-6">
        <div>
          <Link href="/products" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to Products
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">{product.name}</h1>
          <p className="mt-1 text-sm text-gray-500">{product.category}</p>
        </div>

        <p className="text-gray-700 leading-relaxed">{product.description}</p>

        <div className="flex items-baseline gap-4">
          <span className="text-3xl font-bold text-brand">${product.price.toFixed(2)}</span>
          {product.rating && (
            <span className="text-yellow-500">
              {'★'.repeat(Math.round(product.rating))} ({product.rating.toFixed(1)})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm ${
            product.inStock ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {product.inStock ? 'In Stock' : 'Out of Stock'}
          </span>
        </div>

        <AddToCartButton product={product} />
      </div>
    </div>
  );
}
