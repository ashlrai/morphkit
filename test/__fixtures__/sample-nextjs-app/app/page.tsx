import { fetchProducts } from '@/lib/api';
import { ProductCard } from '@/components/ProductCard';

export default async function HomePage() {
  const products = await fetchProducts();

  return (
    <div className="space-y-8">
      <section className="text-center py-12">
        <h1 className="text-4xl font-bold text-gray-900">Welcome to Sample Store</h1>
        <p className="mt-4 text-lg text-gray-600">Discover our curated collection of products</p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-6">Featured Products</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.slice(0, 8).map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
}
