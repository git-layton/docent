import { extractAndWriteGraph, generateNodeId } from './graphEntityExtractor';

/**
 * Feed a saved memory into the knowledge graph.
 *
 * The missing pipe. Talking is the one input stream that runs constantly, and until now it was the
 * only one that never produced entities: both memory-persist paths wrote a bare stub node per file
 * — `nodeType: 'concept'`, labelled with `titleFromText` (the first sentence of the user's message,
 * truncated at 80 chars). Since `concept` maps to the Topics shelf, the Knowledge Base filled with
 * utterances — "Do it", "Ok is it too late though" — and, because stubs are never connected to
 * anything, the graph had zero edges. A memory file about Baldur's Gate 3 taught the graph nothing
 * about Baldur's Gate 3.
 *
 * So: write the memory as a `note` (a memory file is a note, not a concept) and run the real
 * extractor over it. `extractAndWriteGraph` is reused verbatim — it records the source node
 * unconditionally, batches nodes-then-edges in one transaction, caps at 40 entities / 60 relations,
 * and swallows its own failures.
 */

/**
 * Extraction is serialized. Saves arrive in bursts (a reply lands, the gatekeeper and the salience
 * scorer can both fire), and each extraction is a structured model call — against a local model,
 * several at once contend for the same weights and slow every one of them down. Measured save rate
 * is 1–3/day, so a queue costs nothing in practice; it exists to bound the burst, not the volume.
 */
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  // Keep the chain alive on failure — a rejected link must not poison every later save.
  chain = run.catch(() => undefined);
  return run;
}

export interface IngestMemoryInput {
  /** Absolute path of the memory file just written — the node's stable identity. */
  path: string;
  /** Human label for the node (the memory's title). */
  title: string;
  /** The user's message. */
  text: string;
  /** The assistant's reply. */
  answer?: string;
  modelConfig?: Record<string, unknown> | null;
}

export async function ingestMemoryIntoGraph(input: IngestMemoryInput): Promise<void> {
  const { path, title, text, answer, modelConfig } = input;
  if (!path) return;

  // Both halves of the exchange. The user's phrasing names the thing ("in baldur's gate, I am
  // playing a dark urge"); the answer usually carries the proper nouns and the relationships.
  // Extracting over only one of them loses half the entities.
  const combined = [text, answer].filter(Boolean).join('\n\n').trim();

  await enqueue(() =>
    extractAndWriteGraph({
      text: combined,
      sourceTitle: title || path.split('/').pop() || path,
      sourceNodeId: generateNodeId('memory', path),
      sourceNodeType: 'note',
      sourcePath: path,
      modelConfig: (modelConfig ?? {}) as Record<string, unknown>,
    }),
  ).catch((err) => {
    // Never surfaces to the user and never fails a chat turn: both call sites invoke this
    // fire-and-forget, and a memory is still saved to disk whether or not the graph learns from it.
    console.warn('[conversationGraph] ingest failed:', err);
  });
}
