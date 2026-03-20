import { useParams, Link } from 'react-router-dom';

export function ProductDetail() {
  const { id } = useParams<{ id: string }>();

  return (
    <div>
      <Link to="/products">Back to Products</Link>
      <h2>Product Detail</h2>
      <p>Showing product: {id}</p>
    </div>
  );
}
