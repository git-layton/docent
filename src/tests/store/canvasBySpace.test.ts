import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../../store/useUIStore';
import { useSpaceStore } from '../../store/useSpaceStore';

// The canvas used to be a single global slot — whichever Space touched it last won, and
// switching Spaces showed (and could overwrite) another Space's doc. These tests pin the
// scoped behavior: the doc follows its Space across switches.

const docA = { id: 'art-a', title: 'Space A doc', content: '<p>alpha</p>' };
const docB = { id: 'art-b', title: 'Space B doc', content: '<p>beta</p>' };

describe('per-Space canvas', () => {
  beforeEach(() => {
    useUIStore.setState({ canvasContent: null, canvasBySpace: {} });
    useSpaceStore.setState({ activeSpaceId: null });
  });

  it('stashes the outgoing Space\'s doc and restores it on return', () => {
    useSpaceStore.getState().setActiveSpaceId('space-a');
    useUIStore.getState().setCanvasContent(docA);

    useSpaceStore.getState().setActiveSpaceId('space-b');
    expect(useUIStore.getState().canvasContent).toBeNull(); // B starts clean, not on A's doc

    useUIStore.getState().setCanvasContent(docB);
    useSpaceStore.getState().setActiveSpaceId('space-a');
    expect(useUIStore.getState().canvasContent).toEqual(docA); // A's doc came back

    useSpaceStore.getState().setActiveSpaceId('space-b');
    expect(useUIStore.getState().canvasContent).toEqual(docB); // and B's survived A's visit
  });

  it('edits in one Space never leak into another\'s stash', () => {
    useSpaceStore.getState().setActiveSpaceId('space-a');
    useUIStore.getState().setCanvasContent(docA);
    useSpaceStore.getState().setActiveSpaceId('space-b');
    useUIStore.getState().setCanvasContent({ ...docB, content: '<p>edited in B</p>' });

    useSpaceStore.getState().setActiveSpaceId('space-a');
    expect(useUIStore.getState().canvasContent).toEqual(docA);
    expect(useUIStore.getState().canvasBySpace['space-b'].content).toBe('<p>edited in B</p>');
  });

  it('treats Home (null space) as its own slot', () => {
    useUIStore.getState().setCanvasContent(docA); // on Home
    useSpaceStore.getState().setActiveSpaceId('space-b');
    expect(useUIStore.getState().canvasContent).toBeNull();

    useSpaceStore.getState().setActiveSpaceId(null); // back to Home
    expect(useUIStore.getState().canvasContent).toEqual(docA);
  });

  it('re-selecting the current Space is a no-op for the canvas', () => {
    useSpaceStore.getState().setActiveSpaceId('space-a');
    useUIStore.getState().setCanvasContent(docA);
    useSpaceStore.getState().setActiveSpaceId('space-a');
    expect(useUIStore.getState().canvasContent).toEqual(docA);
  });
});
