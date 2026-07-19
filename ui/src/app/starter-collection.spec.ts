import { describe, expect, it } from 'vitest';
import { STARTER_COLLECTION } from './starter-collection';

describe('STARTER_COLLECTION', () => {
  it('ships the complete, unique 25-account starter set', () => {
    expect(STARTER_COLLECTION).toHaveLength(25);
    expect(new Set(STARTER_COLLECTION.map((account) => account.handle.toLowerCase())).size).toBe(
      25,
    );
    expect(STARTER_COLLECTION).toContainEqual({
      name: 'Eugen Rochko',
      handle: 'Gargron@mastodon.social',
    });
    expect(STARTER_COLLECTION).toContainEqual({
      name: 'LucasArts Places',
      handle: 'lucasarts_places@mastodon.social',
    });
  });
});
