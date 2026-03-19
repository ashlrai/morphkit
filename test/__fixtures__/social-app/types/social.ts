export interface Profile {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  followersCount: number;
  followingCount: number;
  isVerified: boolean;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  followersCount: number;
  followingCount: number;
  isVerified: boolean;
}

export interface Post {
  id: string;
  author: User;
  content: string;
  images?: string[];
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  createdAt: string;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  participant: User;
  lastMessageContent: string;
  lastMessageAt: string;
  unreadCount: number;
}
