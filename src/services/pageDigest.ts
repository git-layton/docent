import { writeMemory } from '../lib/ipc';
import { generateTextResponse } from './llm';
import { buildGroundingFrontmatter, buildBrowserChunkContext } from './grounding';
import { slugify } from './research';

export interface PageDigestInput {
  url: string;
  title: string;
  cleanText: string;
  wordCount: number;
  capturedAt: number;
  isPrivate: boolean;
}

export interface PageDigestResult {
  summary: string;
  filename: string;
  skipped: boolean;
  skipReason?: string;
}

export async function generatePageDigest(
  input: PageDigestInput,
  modelConfig: unknown,
  agentForgePath: string,
): Promise<PageDigestResult> {
  if (input.isPrivate) {
    return { skipped: true, skipReason: 'private page', summary: '', filename: '' };
  }

  if (input.wordCount < 100) {
    return { skipped: true, skipReason: 'insufficient content', summary: '', filename: '' };
  }

  const promptContent = `Summarize this web page in 3-5 sentences. Focus on the key facts, claims, or ideas. Be specific, not generic.

Title: ${input.title}
URL: ${input.url}

Content:
${input.cleanText.slice(0, 8000)}`;

  let summary = '';
  try {
    summary = await generateTextResponse({
      messages: [{ id: `digest-${input.capturedAt}`, role: 'user', content: promptContent }],
      modelConfig,
      agent: { prompt: 'You are a concise web page summarizer. Return only the summary, no preamble.', tools: {}, trainingDocs: [] },
      profile: '',
      tasks: [],
      attachedDocs: [],
      agentPinnedMessages: [],
      mode: 'text',
      canvasContent: null,
      isDeepThinking: false,
      onChunk: null,
      signal: null,
      appSettings: {},
      integrations: {},
      models: [],
    });
  } catch {
    return { skipped: true, skipReason: 'AI summary failed', summary: '', filename: '' };
  }

  summary = summary.trim();
  const capturedAtIso = new Date(input.capturedAt).toISOString();

  const contextHeader = buildBrowserChunkContext({
    sourceTitle: input.title,
    url: input.url,
    capturedAt: capturedAtIso,
    oneSentenceSummary: summary.split(/[.!?]/)[0].trim() || summary.slice(0, 120),
  });

  const frontmatter = buildGroundingFrontmatter({
    title: input.title,
    type: 'web_capture',
    scope: 'library',
    createdAt: capturedAtIso,
    sourceKind: 'browser',
    sourceUrls: [input.url],
    evidenceState: 'capture_backed',
    tags: ['web', 'browser'],
  });

  const slug = slugify(input.title, 'page');
  const filename = `web_${slug}_${input.capturedAt}.md`;
  const filePath = `${agentForgePath}/memory/research/${filename}`;

  const fileContent = `${frontmatter}${contextHeader}

## Summary
${summary}

## Source
- URL: ${input.url}
- Captured: ${capturedAtIso}
- Word count: ${input.wordCount}
`;

  await writeMemory({
    path: filePath,
    content: fileContent,
    commitMessage: `web-capture: ${input.title.slice(0, 60)}`,
  });

  return { summary, filename, skipped: false };
}
