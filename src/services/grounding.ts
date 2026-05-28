export type MemoryScope = 'agent' | 'channel' | 'library' | 'global';
export type EvidenceState =
  | 'user_provided'
  | 'source_backed'
  | 'capture_backed'
  | 'agent_inferred'
  | 'mixed'
  | 'unverified';
export type VerificationState =
  | 'verified'
  | 'partially_verified'
  | 'needs_verification'
  | 'unverified';
export type ConfidenceState = 'high' | 'medium' | 'low' | 'unknown';

export interface GroundingMetadata {
  title: string;
  type: string;
  scope: MemoryScope;
  createdAt?: string;
  updatedAt?: string;
  agentId?: string;
  agentName?: string;
  channelId?: string;
  channelName?: string;
  sourceKind: string;
  sourceLabel?: string;
  sourceUrl?: string;
  sourceUrls?: string[];
  sourcePath?: string;
  sourcePaths?: string[];
  captureId?: string;
  rawPath?: string;
  derivedFrom?: string[];
  tags?: string[];
  evidenceState?: EvidenceState;
  verification?: VerificationState;
  confidence?: ConfidenceState;
  processor?: string;
  sourceCount?: number;
}

const LABELS: Record<string, string> = {
  user_provided: 'User provided',
  source_backed: 'Source backed',
  capture_backed: 'Capture backed',
  agent_inferred: 'Agent inferred',
  mixed: 'Mixed evidence',
  unverified: 'Unverified',
  verified: 'Verified',
  partially_verified: 'Partially verified',
  needs_verification: 'Needs verification',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
};

const clean = (value: unknown) => String(value ?? '').trim();

const yamlString = (value: unknown) =>
  `"${clean(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const yamlArray = (values: unknown[] = []) => {
  const safe = values.map(clean).filter(Boolean);
  return `[${safe.map(yamlString).join(', ')}]`;
};

const line = (label: string, value: unknown) => {
  const text = clean(value);
  return text ? `- ${label}: ${text}` : '';
};

const listBlock = (label: string, values: unknown[] = []) => {
  const safe = values.map(clean).filter(Boolean);
  if (!safe.length) return '';
  return `- ${label}:\n${safe.map(v => `  - ${v}`).join('\n')}`;
};

const compactLines = (lines: string[]) => lines.filter(Boolean).join('\n');

export const buildGroundingFrontmatter = (metadata: GroundingMetadata) => {
  const createdAt = metadata.createdAt ?? new Date().toISOString();
  const sourceUrls = [
    ...(metadata.sourceUrl ? [metadata.sourceUrl] : []),
    ...(metadata.sourceUrls ?? []),
  ];
  const sourcePaths = [
    ...(metadata.sourcePath ? [metadata.sourcePath] : []),
    ...(metadata.sourcePaths ?? []),
  ];

  return compactLines([
    '---',
    `title: ${yamlString(metadata.title)}`,
    `type: ${yamlString(metadata.type)}`,
    `scope: ${yamlString(metadata.scope)}`,
    `created: ${yamlString(createdAt)}`,
    metadata.updatedAt ? `updated: ${yamlString(metadata.updatedAt)}` : '',
    metadata.agentId ? `agent_id: ${yamlString(metadata.agentId)}` : '',
    metadata.agentName ? `agent: ${yamlString(metadata.agentName)}` : '',
    metadata.channelId ? `channel_id: ${yamlString(metadata.channelId)}` : '',
    metadata.channelName ? `channel: ${yamlString(metadata.channelName)}` : '',
    `source_kind: ${yamlString(metadata.sourceKind)}`,
    metadata.sourceLabel ? `source_label: ${yamlString(metadata.sourceLabel)}` : '',
    sourceUrls.length ? `source_urls: ${yamlArray(sourceUrls)}` : '',
    sourcePaths.length ? `source_paths: ${yamlArray(sourcePaths)}` : '',
    metadata.captureId ? `capture_id: ${yamlString(metadata.captureId)}` : '',
    metadata.rawPath ? `raw_path: ${yamlString(metadata.rawPath)}` : '',
    metadata.derivedFrom?.length ? `derived_from: ${yamlArray(metadata.derivedFrom)}` : '',
    `evidence_state: ${yamlString(metadata.evidenceState ?? 'unverified')}`,
    `verification: ${yamlString(metadata.verification ?? 'needs_verification')}`,
    `confidence: ${yamlString(metadata.confidence ?? 'unknown')}`,
    metadata.sourceCount !== undefined ? `source_count: ${metadata.sourceCount}` : '',
    `processor: ${yamlString(metadata.processor ?? 'agent-forge')}`,
    `tags: ${yamlArray(metadata.tags ?? [])}`,
    '---',
  ]) + '\n\n';
};

export const buildGroundingSection = (metadata: GroundingMetadata) => {
  const sourceUrls = [
    ...(metadata.sourceUrl ? [metadata.sourceUrl] : []),
    ...(metadata.sourceUrls ?? []),
  ];
  const sourcePaths = [
    ...(metadata.sourcePath ? [metadata.sourcePath] : []),
    ...(metadata.sourcePaths ?? []),
  ];
  const evidence = metadata.evidenceState ?? 'unverified';
  const verification = metadata.verification ?? 'needs_verification';
  const confidence = metadata.confidence ?? 'unknown';

  return `## Grounding
${compactLines([
    line('Evidence state', LABELS[evidence] ?? evidence),
    line('Verification', LABELS[verification] ?? verification),
    line('Confidence', LABELS[confidence] ?? confidence),
    line('Source kind', metadata.sourceKind),
    line('Source label', metadata.sourceLabel),
    line('Capture ID', metadata.captureId),
    line('Raw path', metadata.rawPath),
    listBlock('Source URLs', sourceUrls),
    listBlock('Source paths', sourcePaths),
    listBlock('Derived from', metadata.derivedFrom ?? []),
    line('Scope', metadata.scope),
    line('Agent', metadata.agentName || metadata.agentId),
    line('Channel', metadata.channelName || metadata.channelId),
    line('Processed by', metadata.processor ?? 'agent-forge'),
  ]) || '- No grounding metadata available.'}

## Learning Status
This memory may guide future answers, but factual claims must stay tied to the grounding above. User-provided and source-backed facts can be treated as stronger evidence. Agent-inferred content is a hypothesis until verified.
`;
};

export const buildGroundedMarkdown = (metadata: GroundingMetadata, body: string) =>
  `${buildGroundingFrontmatter(metadata)}# ${metadata.title}\n\n${buildGroundingSection(metadata)}\n\n${body.trim()}\n`;
