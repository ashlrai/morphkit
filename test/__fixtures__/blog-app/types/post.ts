export interface Post {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  author: Author;
  publishedAt: Date;
  updatedAt: Date;
  tags: string[];
  coverImage?: string;
  isPublished: boolean;
}

export interface Author {
  id: string;
  name: string;
  avatar: string;
  bio?: string;
}

export interface Comment {
  id: string;
  postId: string;
  author: string;
  content: string;
  createdAt: Date;
}
