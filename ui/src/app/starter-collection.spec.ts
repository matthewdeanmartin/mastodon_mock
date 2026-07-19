import { describe, expect, it } from 'vitest';
import { STARTER_COLLECTION } from './starter-collection';

describe('STARTER_COLLECTION', () => {
  it('ships the complete, unique 24-account starter set without the retired botsin.space account', () => {
    expect(STARTER_COLLECTION).toHaveLength(24);
    expect(new Set(STARTER_COLLECTION.map((account) => account.handle.toLowerCase())).size).toBe(
      24,
    );
    expect(STARTER_COLLECTION.some((account) => account.handle.endsWith('@botsin.space'))).toBe(
      false,
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
