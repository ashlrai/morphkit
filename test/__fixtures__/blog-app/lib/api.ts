import type { Post, Comment } from '@/types/post';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.blog-cms.example.com';

export async function fetchPosts(): Promise<Post[]> {
  const res = await fetch(`${API_BASE}/posts`, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error('Failed to fetch posts');
  return res.json();
}

export async function fetchPost(slug: string): Promise<Post> {
  const res = await fetch(`${API_BASE}/posts/${slug}`);
  if (!res.ok) throw new Error('Post not found');
  return res.json();
}

export async function fetchComments(postId: string): Promise<Comment[]> {
  const res = await fetch(`${API_BASE}/posts/${postId}/comments`);
  if (!res.ok) throw new Error('Failed to fetch comments');
  return res.json();
}

export async function submitComment(
  postId: string,
  author: string,
  content: string,
): Promise<Comment> {
  const res = await fetch(`${API_BASE}/posts/${postId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, content }),
  });
  if (!res.ok) throw new Error('Failed to submit comment');
  return res.json();
}
