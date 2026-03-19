import { fetchUserProfile, fetchUserPosts } from '@/lib/api';
import { PostCard } from '@/components/PostCard';
import Image from 'next/image';

interface ProfilePageProps {
  params: { username: string };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const user = await fetchUserProfile(params.username);
  const posts = await fetchUserPosts(params.username);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-6">
        <Image
          src={user.avatar}
          alt={user.displayName}
          width={96}
          height={96}
          className="rounded-full"
        />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{user.displayName}</h1>
            {user.isVerified && (
              <span className="text-blue-500" title="Verified">✓</span>
            )}
          </div>
          <p className="text-gray-500">@{user.username}</p>
          {user.bio && <p className="mt-2 text-gray-700">{user.bio}</p>}
          <div className="mt-2 flex gap-4 text-sm text-gray-500">
            <span><strong className="text-gray-900">{user.followersCount}</strong> followers</span>
            <span><strong className="text-gray-900">{user.followingCount}</strong> following</span>
          </div>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-4">Posts</h2>
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      </section>
    </div>
  );
}
