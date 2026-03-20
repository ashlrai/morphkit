import { useState, useEffect } from 'react';

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  imageUrl: string;
  category: string;
}

export default function ProductDetail() {
  const [product, setProduct] = useState<Product | null>(null);

  return (
    <div>
      {product ? (
        <div>
          <img src={product.imageUrl} alt={product.name} />
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          <p>${product.price}</p>
          <button>Add to Cart</button>
        </div>
      ) : (
        <p>Loading...</p>
      )}
    </div>
  );
}
