import { fetchPost, fetchComments } from '@/lib/api';
import { CommentForm } from '@/components/CommentForm';
import Image from 'next/image';
import Link from 'next/link';

interface PostPageProps {
  params: { slug: string };
}

export default async function PostPage({ params }: PostPageProps) {
  const post = await fetchPost(params.slug);
  const comments = await fetchComments(post.id);

  return (
    <article className="space-y-8">
      <div>
        <Link href="/blog" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to Blog
        </Link>
      </div>

      {post.coverImage && (
        <div className="relative aspect-video overflow-hidden rounded-xl">
          <Image src={post.coverImage} alt={post.title} fill className="object-cover" />
        </div>
      )}

      <header className="space-y-4">
        <h1 className="text-4xl font-bold text-gray-900">{post.title}</h1>
        <div className="flex items-center gap-4 text-gray-600">
          <div className="flex items-center gap-2">
            <Image
              src={post.author.avatar}
              alt={post.author.name}
              width={32}
              height={32}
              className="rounded-full"
            />
            <span className="font-medium">{post.author.name}</span>
          </div>
          <time dateTime={post.publishedAt.toISOString()}>
            {new Date(post.publishedAt).toLocaleDateString()}
          </time>
        </div>
        <div className="flex gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="inline-block rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
            >
              {tag}
            </span>
          ))}
        </div>
      </header>

      <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: post.content }} />

      <section className="border-t pt-8 space-y-6">
        <h2 className="text-2xl font-semibold">Comments ({comments.length})</h2>

        {comments.map((comment) => (
          <div key={comment.id} className="border rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-900">{comment.author}</span>
              <time className="text-sm text-gray-500">
                {new Date(comment.createdAt).toLocaleDateString()}
              </time>
            </div>
            <p className="text-gray-700">{comment.content}</p>
          </div>
        ))}

        <CommentForm postId={post.id} />
      </section>
    </article>
  );
}
