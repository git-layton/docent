import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../../store/useUIStore';
import { useSpaceStore } from '../../store/useSpaceStore';
import { useReceiptStore, __resetReceipts } from '../../services/receipts';

// Draft approvals: Docent's edits to an existing canvas stage as a proposal — the document
// never changes until the user accepts, accept is receipt-backed with a working undo, and a
// pending proposal follows its Space.

const doc = { id: 'art-1', title: 'Plan', content: '<p>original</p>', type: 'doc', history: [{ timestamp: 1, content: '<p>original</p>' }], historyIndex: 0 };

describe('canvas draft approvals', () => {
  beforeEach(() => {
    __resetReceipts();
    useUIStore.setState({ canvasContent: { ...doc }, canvasProposal: null, canvasBySpace: {}, canvasProposalBySpace: {} });
    useSpaceStore.setState({ activeSpaceId: null });
  });

  it('accept applies the proposal, pushes history, and clears it', async () => {
    useUIStore.getState().setCanvasProposal({ content: '<p>edited</p>', prevContent: '<p>original</p>', streaming: false });
    useUIStore.getState().acceptCanvasProposal();
    const c = useUIStore.getState().canvasContent;
    expect(c.content).toBe('<p>edited</p>');
    expect(c.history[c.historyIndex].content).toBe('<p>edited</p>');
    expect(useUIStore.getState().canvasProposal).toBeNull();
  });

  it('accept records an undoable receipt whose undo restores the previous content', async () => {
    useUIStore.getState().setCanvasProposal({ content: '<p>edited</p>', prevContent: '<p>original</p>', streaming: false });
    useUIStore.getState().acceptCanvasProposal();
    expect(useReceiptStore.getState().receipts.length).toBe(1);
    const receipt = useReceiptStore.getState().receipts[0];
    expect(receipt.surface).toBe('canvas');
    expect(useReceiptStore.getState().isUndoable(receipt.id)).toBe(true);

    await useReceiptStore.getState().undo(receipt.id);
    expect(useUIStore.getState().canvasContent.content).toBe('<p>original</p>');
  });

  it('a streaming proposal cannot be accepted', () => {
    useUIStore.getState().setCanvasProposal({ content: '<p>partial</p>', prevContent: '<p>original</p>', streaming: true });
    useUIStore.getState().acceptCanvasProposal();
    expect(useUIStore.getState().canvasContent.content).toBe('<p>original</p>');
    expect(useUIStore.getState().canvasProposal).not.toBeNull();
  });

  it('reject discards the proposal and leaves the document byte-identical', () => {
    useUIStore.getState().setCanvasProposal({ content: '<p>edited</p>', prevContent: '<p>original</p>', streaming: false });
    useUIStore.getState().rejectCanvasProposal();
    expect(useUIStore.getState().canvasProposal).toBeNull();
    expect(useUIStore.getState().canvasContent.content).toBe('<p>original</p>');
  });

  it('a pending proposal follows its Space across switches', () => {
    useUIStore.getState().setCanvasProposal({ content: '<p>edited</p>', prevContent: '<p>original</p>', streaming: false });
    useSpaceStore.getState().setActiveSpaceId('space-b');
    expect(useUIStore.getState().canvasProposal).toBeNull(); // B has no pending review
    useSpaceStore.getState().setActiveSpaceId(null);
    expect(useUIStore.getState().canvasProposal?.content).toBe('<p>edited</p>'); // home's review is back
  });
});
