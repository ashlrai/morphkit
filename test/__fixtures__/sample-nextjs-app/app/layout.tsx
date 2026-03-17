import type { Metadata } from 'next';
import { CartButton } from '@/components/CartButton';

export const metadata: Metadata = {
  title: 'Sample Store',
  description: 'A sample e-commerce store built with Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <header className="sticky top-0 z-50 bg-white border-b">
          <nav className="mx-auto max-w-7xl flex items-center justify-between px-4 py-3">
            <a href="/" className="text-xl font-bold text-brand">Sample Store</a>
            <div className="flex items-center gap-4">
              <a href="/products" className="text-gray-600 hover:text-gray-900">Products</a>
              <CartButton />
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
