'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Source {
  id: string;
  url: string;
  domain: string;
  title: string;
}

interface ResearchResult {
  id: string;
  query: string;
  content: string;
  sources: Source[];
  depth: string;
  createdAt: string;
}

export default function ResearchDetailPage({ params }: { params: { id: string } }) {
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');

  useEffect(() => {
    loadResearch();
  }, [params.id]);

  async function loadResearch() {
    const response = await fetch(`/api/research/${params.id}`);
    const data = await response.json();
    setResearch(data);
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      {research && (
        <>
          <h1 className="text-2xl font-bold mb-4">{research.query}</h1>
          <div className="prose prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {isStreaming ? streamContent : research.content}
            </ReactMarkdown>
          </div>
          <div className="mt-8 space-y-2">
            <h2 className="text-lg font-semibold">Sources</h2>
            {research.sources.map((source) => (
              <a
                key={source.id}
                href={source.url}
                className="block p-3 bg-surface rounded-lg hover:bg-opacity-80"
              >
                <span className="text-primary">{source.domain}</span>
                <span className="text-gray-400 ml-2">{source.title}</span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
