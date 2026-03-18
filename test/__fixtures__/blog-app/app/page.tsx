import { fetchPosts } from '@/lib/api';
import { PostCard } from '@/components/PostCard';

export default async function HomePage() {
  const posts = await fetchPosts();
  const recentPosts = posts.filter((p) => p.isPublished).slice(0, 5);

  return (
    <div className="space-y-10">
      <section className="text-center py-16">
        <h1 className="text-5xl font-bold text-gray-900">Welcome to Our Blog</h1>
        <p className="mt-4 text-xl text-gray-600">
          Thoughts, stories, and ideas from our team
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-6">Recent Posts</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {recentPosts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      </section>
    </div>
  );
}
