import { Link } from 'react-router-dom';

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
}

const products: Product[] = [
  { id: '1', name: 'Widget', price: 9.99, description: 'A fine widget' },
  { id: '2', name: 'Gadget', price: 19.99, description: 'A fancy gadget' },
];

export function Products() {
  return (
    <div>
      <h2>Products</h2>
      <ul>
        {products.map((product) => (
          <li key={product.id}>
            <Link to={`/products/${product.id}`}>
              {product.name} - ${product.price}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
