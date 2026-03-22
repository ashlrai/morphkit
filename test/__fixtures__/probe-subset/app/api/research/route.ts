import { NextRequest } from 'next/server';

export const maxDuration = 300;

interface ResearchRequest {
  query: string;
  depth: 'flash' | 'quick' | 'deep';
}

export async function POST(request: NextRequest) {
  const body: ResearchRequest = await request.json();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Status event
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'Starting research...' })}\n\n`));

      // Agent status events
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'agent_status', agent: 'researcher', status: 'active' })}\n\n`));

      // Content chunk events
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content: 'Research results here...' })}\n\n`));

      // Complete event
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete', researchId: 'abc123' })}\n\n`));

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
