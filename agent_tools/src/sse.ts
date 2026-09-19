// A minimal Server-Sent Events reader: one long-lived GET, yielded as
// parsed events. Comments (`: ping` heartbeats) are dropped.

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
}

export type EventStreamOpener = (url: string) => AsyncIterable<SseEvent>;

// The platform sends a `: ping` comment every 15 seconds on an idle
// stream. Silence for much longer than that means the connection is dead
// without having closed — a laptop that slept, a network that changed —
// and a reader that kept waiting would look alive forever.
const IDLE_TIMEOUT_MS = 60_000;

export async function* openEventStream(url: string): AsyncGenerator<SseEvent> {
  const abort = new AbortController();
  let idle: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => abort.abort(new Error('event stream went silent')), IDLE_TIMEOUT_MS);
  };
  touch();
  try {
    const response = await fetch(url, { headers: { Accept: 'text/event-stream' }, signal: abort.signal });
    if (!response.ok || !response.body) {
      throw new Error(`event stream refused (http ${response.status})`);
    }
    const chunks = response.body.pipeThrough(new TextDecoderStream());
    yield* parseEventStream(watched(chunks, touch));
  } finally {
    clearTimeout(idle);
    abort.abort();
  }
}

/** Passes chunks through, reporting each one — heartbeats included — as a sign of life. */
async function* watched(chunks: AsyncIterable<string>, onChunk: () => void): AsyncGenerator<string> {
  for await (const chunk of chunks) {
    onChunk();
    yield chunk;
  }
}

export async function* parseEventStream(chunks: AsyncIterable<string>): AsyncGenerator<SseEvent> {
  let buffer = '';
  for await (const chunk of chunks) {
    buffer += chunk.replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const event = parseBlock(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (event) yield event;
    }
  }
}

function parseBlock(block: string): SseEvent | undefined {
  const event: SseEvent = { data: '' };
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
    else if (field === 'id') event.id = value;
    else if (field === 'event') event.event = value;
  }
  if (data.length === 0) return undefined;
  event.data = data.join('\n');
  return event;
}
