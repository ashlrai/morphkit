'use client';

import { useState, useEffect } from 'react';
import type { Conversation } from '@/types/social';
import { fetchConversations } from '@/lib/api';
import Image from 'next/image';

export default function MessagesPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    setIsLoading(true);
    try {
      const data = await fetchConversations();
      setConversations(data);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Messages</h1>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        </div>
      ) : conversations.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No messages yet</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-white divide-y">
          {conversations.map((convo) => (
            <a
              key={convo.id}
              href={`/messages/${convo.id}`}
              className="flex items-center gap-4 p-4 hover:bg-gray-50"
            >
              <Image
                src={convo.participant.avatar}
                alt={convo.participant.displayName}
                width={48}
                height={48}
                className="rounded-full"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-gray-900 truncate">{convo.participant.displayName}</p>
                  <p className="text-sm text-gray-500">
                    {new Date(convo.lastMessage.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-sm text-gray-500 truncate">{convo.lastMessage.content}</p>
              </div>
              {convo.unreadCount > 0 && (
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs text-white">
                  {convo.unreadCount}
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
