import { invoke } from '@tauri-apps/api/core';
import { useReceiptStore } from './receipts';

// SECURITY CONTRACT — read before wiring anything new to this module:
// `executeSemanticClick` synthesizes a REAL OS click from text found on screen. Screen
// content is UNTRUSTED (trust model §3: authority actions are never driven solely by
// untrusted content). Today its only caller is the human-typed target form in
// DesktopViewerPanel — that is the contract. Do NOT expose it to the agent's tool grammar
// without an approval gate equivalent to actionNeedsApproval (the click can press Send,
// Delete, or Buy in ANY app, and it is irreversible — its receipt correctly has no undo).

export interface LayoutElement {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when bounds were fabricated (text-only OCR fallback) — NEVER click these. */
  synthetic?: boolean;
}

export interface DesktopContextMesh {
  activeApp: string;
  windowTitle: string;
  elements: LayoutElement[];
  markdownMesh: string;
  blockHashes: string[];
  isDelta: boolean;
}

let lastBlockHashes: string[] = [];

/**
 * Step 1: Local Delta Filter — Divide layout elements into 8x8 block matrix grid hashes
 */
export function computeGridHashes(elements: LayoutElement[], gridDim = 8): string[] {
  const grid: string[][] = Array.from({ length: gridDim * gridDim }, () => []);

  elements.forEach(elem => {
    const col = Math.min(gridDim - 1, Math.max(0, Math.floor((elem.x / 1920) * gridDim)));
    const row = Math.min(gridDim - 1, Math.max(0, Math.floor((elem.y / 1080) * gridDim)));
    const idx = row * gridDim + col;
    grid[idx].push(elem.text);
  });

  return grid.map((block) => {
    if (block.length === 0) return '0';
    const str = block.join('|');
    let hash = 0;
    for (let j = 0; j < str.length; j++) {
      hash = ((hash << 5) - hash + str.charCodeAt(j)) >>> 0;
    }
    return hash.toString(16);
  });
}

export function hasFrameChanged(newHashes: string[], oldHashes: string[]): boolean {
  if (oldHashes.length === 0) return true;
  if (newHashes.length !== oldHashes.length) return true;
  let changedBlocks = 0;
  for (let i = 0; i < newHashes.length; i++) {
    if (newHashes[i] !== oldHashes[i]) changedBlocks++;
  }
  return changedBlocks > 1; // Tolerance threshold
}

/**
 * Step 2: Conceptual Context Map (System Context Mesh)
 */
export function buildSystemContextMesh(
  activeApp: string,
  windowTitle: string,
  elements: LayoutElement[]
): string {
  const lines: string[] = [
    '### SYSTEM CONTEXT MESH ###',
    `Active Application: ${activeApp || 'Desktop'}`,
    `Window Title: ${windowTitle || 'Main Display'}`,
    '',
    '[Detected Layout Elements & Text]',
  ];

  elements.forEach(elem => {
    lines.push(
      `- Region [${elem.id}] (Bounds: x:${Math.round(elem.x)}, y:${Math.round(elem.y)}, w:${Math.round(elem.width)}, h:${Math.round(elem.height)}): "${elem.text}"`
    );
  });

  return lines.join('\n');
}

/**
 * Step 3: Semantic Target Coordinate Mapper (Prevents Coordinate Drift)
 */
export function resolveSemanticTarget(
  targetLabel: string,
  allElements: LayoutElement[]
): { x: number; y: number; label: string; confidence: number } | null {
  const targetLower = targetLabel.toLowerCase().trim();
  if (!targetLower) return null;
  // Only elements with REAL screen bounds are clickable.
  const elements = allElements.filter(e => !e.synthetic);

  // 1. Exact match
  const exact = elements.find(e => e.text.toLowerCase().trim() === targetLower);
  if (exact) {
    return {
      x: exact.x + exact.width / 2,
      y: exact.y + exact.height / 2,
      label: exact.text,
      confidence: 1.0,
    };
  }

  // 2. Contains match
  const contains = elements.find(e => e.text.toLowerCase().includes(targetLower));
  if (contains) {
    return {
      x: contains.x + contains.width / 2,
      y: contains.y + contains.height / 2,
      label: contains.text,
      confidence: 0.85,
    };
  }

  // 3. Word token overlap
  const targetWords = targetLower.split(/\s+/);
  for (const elem of elements) {
    const elemLower = elem.text.toLowerCase();
    if (targetWords.some(w => w.length > 2 && elemLower.includes(w))) {
      return {
        x: elem.x + elem.width / 2,
        y: elem.y + elem.height / 2,
        label: elem.text,
        confidence: 0.65,
      };
    }
  }

  return null;
}

/**
 * Complete Desktop Perception Cycle: Capture, Mesh, Filter, & Return Context
 */
export async function captureDesktopContextMesh(): Promise<DesktopContextMesh> {
  let activeApp = 'Desktop';
  let windowTitle = 'Main Display';

  try {
    const windows = await invoke<Array<{ id: number; app: string; title: string }>>('list_windows');
    if (windows && windows.length > 0) {
      activeApp = windows[0].app;
      windowTitle = windows[0].title;
    }
  } catch (err) {
    console.warn('[DesktopVision] Could not list active windows:', err);
  }

  let rawOcr: any = null;
  try {
    rawOcr = await invoke<any>('capture_screen_text');
  } catch (err) {
    console.warn('[DesktopVision] OCR capture fallback:', err);
  }

  const elements: LayoutElement[] = [];
  if (rawOcr && Array.isArray(rawOcr.blocks)) {
    rawOcr.blocks.forEach((block: any, idx: number) => {
      elements.push({
        id: `elem_${idx}`,
        text: block.text || '',
        x: block.x ?? 0,
        y: block.y ?? 0,
        width: block.width ?? 0,
        height: block.height ?? 0,
      });
    });
  } else if (rawOcr && typeof rawOcr.text === 'string') {
    // Text-only OCR: useful for the context mesh, but the bounds are FABRICATED —
    // `synthetic` keeps it out of click resolution (clicking invented coordinates
    // would press whatever happens to be at that spot on screen).
    elements.push({
      id: 'elem_0',
      text: rawOcr.text,
      x: 100,
      y: 100,
      width: 400,
      height: 200,
      synthetic: true,
    });
  }

  const blockHashes = computeGridHashes(elements);
  const isDelta = hasFrameChanged(blockHashes, lastBlockHashes);
  lastBlockHashes = blockHashes;

  const markdownMesh = buildSystemContextMesh(activeApp, windowTitle, elements);

  return {
    activeApp,
    windowTitle,
    elements,
    markdownMesh,
    blockHashes,
    isDelta,
  };
}

/**
 * Execute Semantic Target Click: Resolve label to coordinates and post click event
 */
export async function executeSemanticClick(targetLabel: string): Promise<{ success: boolean; coords?: { x: number; y: number }; message: string }> {
  const mesh = await captureDesktopContextMesh();
  const resolved = resolveSemanticTarget(targetLabel, mesh.elements);

  if (!resolved) {
    return {
      success: false,
      message: `Could not find UI target matching "${targetLabel}" on screen.`,
    };
  }

  try {
    await invoke('inject_click', { x: resolved.x, y: resolved.y });

    useReceiptStore.getState().record(
      {
        surface: 'system',
        action: 'Semantic Click',
        summary: `Clicked "${resolved.label}" at (${Math.round(resolved.x)}, ${Math.round(resolved.y)})`,
      }
    );

    return {
      success: true,
      coords: { x: resolved.x, y: resolved.y },
      message: `Clicked "${resolved.label}" at (${Math.round(resolved.x)}, ${Math.round(resolved.y)}) with ${Math.round(resolved.confidence * 100)}% confidence`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Click injection failed: ${err?.message ?? String(err)}`,
    };
  }
}
