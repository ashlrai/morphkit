import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blog CMS',
  description: 'A modern blog built with Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white">
        <header className="sticky top-0 z-50 bg-white border-b">
          <nav className="mx-auto max-w-4xl flex items-center justify-between px-4 py-3">
            <a href="/" className="text-xl font-bold text-gray-900">Blog CMS</a>
            <div className="flex items-center gap-6">
              <a href="/blog" className="text-gray-600 hover:text-gray-900">Blog</a>
              <a href="/about" className="text-gray-600 hover:text-gray-900">About</a>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
