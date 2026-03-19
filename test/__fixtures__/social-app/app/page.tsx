'use client';

import { useState, useEffect } from 'react';
import type { Post } from '@/types/social';
import { fetchFeed, likePost } from '@/lib/api';
import { PostCard } from '@/components/PostCard';

export default function FeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadFeed();
  }, []);

  async function loadFeed() {
    setIsLoading(true);
    try {
      const data = await fetchFeed();
      setPosts(data);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLike(postId: string) {
    await likePost(postId);
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 }
          : p,
      ),
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Feed</h1>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onLike={() => handleLike(post.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
