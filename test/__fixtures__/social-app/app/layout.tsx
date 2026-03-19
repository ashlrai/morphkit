import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Social App',
  description: 'A social media app built with Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50">
        <header className="sticky top-0 z-50 bg-white border-b">
          <nav className="mx-auto max-w-2xl flex items-center justify-between px-4 py-3">
            <a href="/" className="text-xl font-bold text-gray-900">Social</a>
            <div className="flex items-center gap-6">
              <a href="/" className="text-gray-600 hover:text-gray-900">Feed</a>
              <a href="/messages" className="text-gray-600 hover:text-gray-900">Messages</a>
              <a href="/profile/me" className="text-gray-600 hover:text-gray-900">Profile</a>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
