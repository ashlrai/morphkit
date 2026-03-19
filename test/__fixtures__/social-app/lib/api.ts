import type { Post, User, Conversation } from '@/types/social';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.social.example.com';

export async function fetchFeed(): Promise<Post[]> {
  const res = await fetch(`${API_BASE}/posts`, { next: { revalidate: 30 } });
  if (!res.ok) throw new Error('Failed to fetch feed');
  return res.json();
}

export async function likePost(postId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/posts/${postId}/like`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to like post');
}

export async function fetchUserProfile(username: string): Promise<User> {
  const res = await fetch(`${API_BASE}/users/${username}`);
  if (!res.ok) throw new Error('User not found');
  return res.json();
}

export async function fetchUserPosts(username: string): Promise<Post[]> {
  const res = await fetch(`${API_BASE}/users/${username}/posts`);
  if (!res.ok) throw new Error('Failed to fetch user posts');
  return res.json();
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/messages`);
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export async function sendMessage(receiverId: string, content: string): Promise<void> {
  const res = await fetch(`${API_BASE}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiverId, content }),
  });
  if (!res.ok) throw new Error('Failed to send message');
}
