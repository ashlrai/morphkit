import { useState, useEffect } from 'react';

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetch('/api/products')
      .then(res => res.json())
      .then(data => setProducts(data));
  }, []);

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div>
      <h1>Products</h1>
      <input
        placeholder="Search products..."
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />
      <ul>
        {filtered.map(p => (
          <li key={p.id}>
            <a href={`/products/${p.id}`}>{p.name} - ${p.price}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
