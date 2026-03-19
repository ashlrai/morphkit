import Image from 'next/image';
import Link from 'next/link';
import type { Post } from '@/types/social';

interface PostCardProps {
  post: Post;
  onLike?: () => void;
}

export function PostCard({ post, onLike }: PostCardProps) {
  return (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${post.author.username}`}>
          <Image
            src={post.author.avatar}
            alt={post.author.displayName}
            width={40}
            height={40}
            className="rounded-full"
          />
        </Link>
        <div>
          <Link href={`/profile/${post.author.username}`} className="font-medium text-gray-900 hover:underline">
            {post.author.displayName}
          </Link>
          <p className="text-sm text-gray-500">
            @{post.author.username} · {new Date(post.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      <p className="text-gray-800">{post.content}</p>

      {post.images && post.images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 rounded-lg overflow-hidden">
          {post.images.map((img, i) => (
            <div key={i} className="relative aspect-square">
              <Image src={img} alt="" fill className="object-cover" />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-6 pt-2 border-t text-sm text-gray-500">
        <button onClick={onLike} className={`flex items-center gap-1 ${post.isLiked ? 'text-red-500' : ''}`}>
          {post.isLiked ? '♥' : '♡'} {post.likesCount}
        </button>
        <span className="flex items-center gap-1">💬 {post.commentsCount}</span>
      </div>
    </div>
  );
}
