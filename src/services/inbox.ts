import { buildGroundedMarkdown, type MemoryScope } from './grounding';
import type { MemoryGatekeeperDecision } from './memoryGatekeeper';

export type CaptureStatus = 'received' | 'processing' | 'needs_review' | 'saved' | 'failed';
export type CaptureKind = 'text' | 'url' | 'image' | 'audio' | 'file' | 'mixed';

export interface CaptureAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  path: string;
}

export interface CaptureItem {
  id: string;
  ownerId: string;
  ownerLabel?: string;
  instanceId?: string;
  shareId?: string;
  deviceName?: string;
  source: string;
  kind: CaptureKind;
  status: CaptureStatus;
  createdAt: number;
  updatedAt: number;
  title: string;
  bodyText: string;
  urls: string[];
  attachments: CaptureAttachment[];
  note: string;
  channelHint: string;
  channelId: string;
  agentId: string;
  targetKind?: 'agent' | 'channel' | 'library' | '';
  tags: string[];
  rawPath: string;
  processedPaths: string[];
  summary?: string;
  error: string;
}

export interface InboxOwner {
  id: string;
  label: string;
}

export const DEFAULT_INBOX_OWNERS: InboxOwner[] = [
  { id: 'primary', label: 'Primary' },
  { id: 'shared', label: 'Shared' },
];

export const sanitizeInboxId = (input: string, fallback = 'primary') => {
  const safe = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe || fallback;
};

export const normalizeInboxOwners = (owners: any[] | undefined): InboxOwner[] => {
  const list = Array.isArray(owners) && owners.length > 0 ? owners : DEFAULT_INBOX_OWNERS;
  const seen = new Set<string>();
  const normalized = list
    .map(owner => ({
      id: sanitizeInboxId(owner?.id ?? owner?.label ?? ''),
      label: String(owner?.label ?? owner?.id ?? 'Inbox').trim() || 'Inbox',
    }))
    .filter(owner => owner.id && !seen.has(owner.id) && seen.add(owner.id));
  return normalized.length ? normalized : DEFAULT_INBOX_OWNERS;
};

export const mergeInboxOwners = (configured: InboxOwner[], captures: CaptureItem[]) => {
  const seen = new Set(configured.map(owner => owner.id));
  const discovered = captures
    .map(capture => ({ id: sanitizeInboxId(capture.ownerId), label: capture.ownerLabel || capture.ownerId }))
    .filter(owner => owner.id && !seen.has(owner.id) && seen.add(owner.id));
  return [...configured, ...discovered];
};

export const ownerLabel = (ownerId: string, owners: InboxOwner[] = DEFAULT_INBOX_OWNERS) =>
  owners.find(o => o.id === ownerId)?.label ?? ownerId;

export const formatCaptureAge = (createdAt: number) => {
  const diff = Math.max(0, Date.now() - createdAt);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const slugifyCapture = (input: string, fallback = 'capture') => {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || fallback;
};

export const inferCaptureKind = (payload: {
  bodyText?: string;
  urls?: string[];
  attachments?: Array<{ mimeType?: string; type?: string; name?: string }>;
}): CaptureKind => {
  const attachments = payload.attachments ?? [];
  if (attachments.length > 1) return 'mixed';
  const first = attachments[0];
  const mime = first?.mimeType ?? first?.type ?? '';
  if (mime.startsWith('image/')) return payload.bodyText || payload.urls?.length ? 'mixed' : 'image';
  if (mime.startsWith('audio/')) return payload.bodyText || payload.urls?.length ? 'mixed' : 'audio';
  if (first) return payload.bodyText || payload.urls?.length ? 'mixed' : 'file';
  if ((payload.urls ?? []).length > 0) return payload.bodyText ? 'mixed' : 'url';
  return 'text';
};

export const buildCaptureMarkdown = ({
  capture,
  summary,
  facts,
  tags,
  targetLabel,
  gatekeeperDecision,
}: {
  capture: CaptureItem;
  summary: string;
  facts: string[];
  tags: string[];
  targetLabel: string;
  gatekeeperDecision?: MemoryGatekeeperDecision;
}) => {
  const tagList = tags.length ? tags.map(t => t.replace(/[^a-zA-Z0-9-_]/g, '')).filter(Boolean) : ['inbox'];
  const scope: MemoryScope = targetLabel.startsWith('channel:')
    ? 'channel'
    : targetLabel === 'library'
      ? 'library'
      : 'agent';
  const groundingTags = Array.from(new Set(['inbox', capture.kind, ...tagList, ...(gatekeeperDecision?.tags ?? [])]));
  const factsBlock = facts.length
    ? facts.map(f => `- ${f}`).join('\n')
    : '- No durable facts extracted.';
  const urlsBlock = capture.urls?.length
    ? capture.urls.map(url => `- ${url}`).join('\n')
    : '- None';
  const attachmentsBlock = capture.attachments?.length
    ? capture.attachments.map(a => `- ${a.name} (${a.mimeType || 'file'}, ${a.size} bytes)`).join('\n')
    : '- None';

  return buildGroundedMarkdown(
    {
      title: capture.title || 'Inbox Capture',
      type: 'inbox-capture',
      scope,
      createdAt: new Date(capture.createdAt).toISOString(),
      sourceKind: capture.source || 'capture',
      sourceLabel: `${capture.ownerLabel || capture.ownerId}${capture.deviceName ? ` via ${capture.deviceName}` : ''}`,
      sourceUrls: capture.urls ?? [],
      captureId: capture.id,
      rawPath: capture.rawPath,
      derivedFrom: capture.rawPath ? [capture.rawPath] : [],
      evidenceState: gatekeeperDecision?.evidenceState ?? 'capture_backed',
      verification: gatekeeperDecision?.verification ?? (capture.urls?.length ? 'partially_verified' : 'needs_verification'),
      confidence: gatekeeperDecision?.confidence ?? 'medium',
      processor: 'memory-gatekeeper',
      tags: groundingTags,
    },
    `## Summary
${summary}

## Extracted Facts
${factsBlock}

## Original Note
${capture.note || '_No extra note._'}

## Text
${capture.bodyText || '_No text content._'}

## URLs
${urlsBlock}

## Attachments
${attachmentsBlock}

## Routing
- Target: ${targetLabel}
- Owner: ${capture.ownerLabel || capture.ownerId}
- Instance: ${capture.instanceId || '_None_'}
- Share route: ${capture.shareId || '_None_'}
- Device: ${capture.deviceName || '_None_'}

## Memory Gatekeeper
- Destination: ${gatekeeperDecision?.destination ?? scope}
- Memory type: ${gatekeeperDecision?.memoryType ?? 'capture'}
- Evidence: ${gatekeeperDecision?.evidenceState ?? 'capture_backed'}
- Verification: ${gatekeeperDecision?.verification ?? (capture.urls?.length ? 'partially_verified' : 'needs_verification')}
- Confidence: ${gatekeeperDecision?.confidence ?? 'medium'}
- Sensitivity: ${gatekeeperDecision?.sensitivity ?? 'normal'}
- Reason: ${gatekeeperDecision?.reason ?? 'capture processed from inbox'}`
  );
};
