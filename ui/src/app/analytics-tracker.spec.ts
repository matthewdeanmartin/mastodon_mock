import { sanitizePath } from './analytics-tracker';

describe('sanitizePath', () => {
  it('collapses account ids', () => {
    expect(sanitizePath('/accounts/111422974327710290')).toBe('/accounts/:id');
  });

  it('collapses status ids', () => {
    expect(sanitizePath('/statuses/109537754750046498')).toBe('/statuses/:id');
  });

  it('collapses tag lookups', () => {
    expect(sanitizePath('/tags/mastodon')).toBe('/tags/:id');
  });

  it('collapses ids under settings sub-routes', () => {
    expect(sanitizePath('/settings/filters/42')).toBe('/settings/filters/:id');
    expect(sanitizePath('/lists/7')).toBe('/lists/:id');
    expect(sanitizePath('/collections/abc')).toBe('/collections/:id');
  });

  it('strips the query string entirely', () => {
    expect(
      sanitizePath('/conversations?open=pub%3Acynical13%40vivaldi.net&with=109537754750046498'),
    ).toBe('/conversations');
  });

  it('strips the fragment', () => {
    expect(sanitizePath('/accounts/123#pinned')).toBe('/accounts/:id');
  });

  it('leaves static child routes readable', () => {
    expect(sanitizePath('/settings/filters/new')).toBe('/settings/filters/new');
    expect(sanitizePath('/collections/starter')).toBe('/collections/starter');
  });

  it('passes static routes through unchanged', () => {
    expect(sanitizePath('/home')).toBe('/home');
    expect(sanitizePath('/settings/privacy')).toBe('/settings/privacy');
    expect(sanitizePath('/')).toBe('/');
  });

  it('does not treat a bare collection route as an id', () => {
    expect(sanitizePath('/lists')).toBe('/lists');
  });
});
