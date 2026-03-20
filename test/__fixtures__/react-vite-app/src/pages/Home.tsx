import { Outlet, Link } from 'react-router-dom';

export function Home() {
  return (
    <div>
      <nav>
        <Link to="/products">Products</Link>
        <Link to="/about">About</Link>
        <Link to="/settings">Settings</Link>
      </nav>
      <main>
        <h1>Welcome to the Store</h1>
        <Outlet />
      </main>
    </div>
  );
}
