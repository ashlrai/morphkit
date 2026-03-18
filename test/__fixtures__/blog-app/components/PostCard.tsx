import Image from 'next/image';
import Link from 'next/link';
import type { Post } from '@/types/post';

interface PostCardProps {
  post: Post;
}

export function PostCard({ post }: PostCardProps) {
  return (
    <div className="rounded-lg border bg-white overflow-hidden hover:shadow-md transition-shadow">
      {post.coverImage && (
        <Link href={`/blog/${post.slug}`}>
          <div className="relative aspect-video overflow-hidden">
            <Image src={post.coverImage} alt={post.title} fill className="object-cover" />
          </div>
        </Link>
      )}
      <div className="p-5 space-y-3">
        <div className="flex gap-2">
          {post.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
            >
              {tag}
            </span>
          ))}
        </div>
        <Link href={`/blog/${post.slug}`}>
          <h3 className="font-semibold text-lg text-gray-900 hover:text-blue-600 line-clamp-2">
            {post.title}
          </h3>
        </Link>
        <p className="text-sm text-gray-500 line-clamp-3">{post.excerpt}</p>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Image
            src={post.author.avatar}
            alt={post.author.name}
            width={24}
            height={24}
            className="rounded-full"
          />
          <span>{post.author.name}</span>
          <span>&middot;</span>
          <time>{new Date(post.publishedAt).toLocaleDateString()}</time>
        </div>
      </div>
    </div>
  );
}
