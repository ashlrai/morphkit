import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Analytics Dashboard',
  description: 'Real-time analytics dashboard built with Next.js',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 font-sans antialiased">
        <aside className="fixed inset-y-0 left-0 w-64 bg-white border-r">
          <div className="p-6">
            <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          </div>
          <nav className="mt-4 px-4 space-y-1">
            <a href="/" className="flex items-center px-3 py-2 text-sm font-medium rounded-md bg-gray-100 text-gray-900">
              Overview
            </a>
            <a href="/settings" className="flex items-center px-3 py-2 text-sm font-medium rounded-md text-gray-600 hover:bg-gray-50">
              Settings
            </a>
          </nav>
        </aside>
        <main className="ml-64 p-8">{children}</main>
      </body>
    </html>
  );
}
