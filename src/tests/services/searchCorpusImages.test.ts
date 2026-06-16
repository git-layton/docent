import { describe, it, expect, beforeEach } from 'vitest';
import { buildSearchCorpus } from '../../services/searchCorpus';
import { useUIStore } from '../../store/useUIStore';
import { useSpaceStore } from '../../store/useSpaceStore';

// buildSearchCorpus reads live store state via getState(); set savedApps and leave the rest default.
const setImages = (apps: any[]) => useUIStore.setState({ savedApps: apps });

const DATA_URL = 'data:image/png;base64,AAAA';

describe('buildSearchCorpus — Image Library entries', () => {
  beforeEach(() => {
    setImages([]);
    useSpaceStore.setState({ omniTabs: [], spaces: [] } as any);
  });

  it('emits an Image doc searchable by description, with a thumbnail and NO base64 in the body', () => {
    setImages([{ id: 'i1', type: 'image', content: DATA_URL, description: 'a red bicycle leaning on a wall', source: 'attached', spaceId: 'space-1', updatedAt: 5 }]);
    const corpus = buildSearchCorpus({ kind: 'global' });
    const img = corpus.find(d => d.id === 'img-i1');
    expect(img).toBeTruthy();
    expect(img!.kind).toBe('Image');
    expect(img!.body).toBe('a red bicycle leaning on a wall'); // searchable text = the description
    expect(img!.image).toBe(DATA_URL);                          // thumbnail src
    expect(img!.sub).toBe('Attached image');
    // The base64 blob must never leak into a searchable Doc body.
    expect(corpus.some(d => d.kind === 'Doc' && d.body === DATA_URL)).toBe(false);
    expect(corpus.some(d => d.id === 'doc-i1')).toBe(false);
  });

  it('non-image saved apps still surface as Doc (global only)', () => {
    setImages([{ id: 'd1', type: 'doc', title: 'Notes', content: 'hello world', updatedAt: 1 }]);
    const corpus = buildSearchCorpus({ kind: 'global' });
    expect(corpus.find(d => d.id === 'doc-d1')?.kind).toBe('Doc');
  });

  it('space scope only includes images belonging to that space', () => {
    setImages([
      { id: 'a', type: 'image', content: DATA_URL, spaceId: 'space-1', updatedAt: 1 },
      { id: 'b', type: 'image', content: DATA_URL, spaceId: 'space-2', updatedAt: 2 },
      { id: 'c', type: 'image', content: DATA_URL, updatedAt: 3 }, // orphan (no space)
    ]);
    const ids = buildSearchCorpus({ kind: 'space', spaceId: 'space-1' }).filter(d => d.kind === 'Image').map(d => d.id);
    expect(ids).toEqual(['img-a']);
    // Global sees them all (incl. the orphan).
    const globalIds = buildSearchCorpus({ kind: 'global' }).filter(d => d.kind === 'Image').map(d => d.id).sort();
    expect(globalIds).toEqual(['img-a', 'img-b', 'img-c']);
  });
});
