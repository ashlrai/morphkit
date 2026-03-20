import { useState, useEffect } from 'react';

interface Product {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/products')
      .then(res => res.json())
      .then(data => setProducts(data))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div>
      <h1>Welcome to Our Store</h1>
      {isLoading ? (
        <p>Loading...</p>
      ) : (
        <div>
          {products.map(product => (
            <div key={product.id}>
              <img src={product.imageUrl} alt={product.name} />
              <h2>{product.name}</h2>
              <p>${product.price}</p>
              <a href={`/products/${product.id}`}>View Details</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
