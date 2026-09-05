# Bundled starter catalogue

The UI ships a snapshot from `mawkingbird_starters/catalog/`. No catalogue requests
go to GitHub Pages at runtime. Existing hand-picked kits and native collection
snapshots remain visible; endorsements and live collection tools keep their existing
flows. Catalogue kits use the same ImportFollows machinery as the hand-picked kits:
anonymous follows use home-instance IDs, signed-in follows resolve each handle on
the reader's server.

From `mastodon_mock/ui`, in Git Bash:

```bash
make starter-catalog-update
make starter-catalog-check
# Or import another checked-out catalogue:
make starter-catalog-update CATALOG=/path/to/mawkingbird_starters/catalog
```

Refresh the source repository's published catalogue first. The default command
reads the sibling checkout, including its uncommitted catalogue changes. It does
not crawl accounts or fetch a remote branch. Review the generated JSON diff,
commit it with the UI, and publish through the normal Mawkingbird release process.
No scheduler or automatic publication is configured.

The importer checks the version, identities, member counts, profile fields and
URLs before writing. Profiles absent from the current display cache are omitted;
empty packs disappear. Each import replaces the whole snapshot so old members are
not carried forward. It does not reinterpret the source catalogue's consent policy.
Builds validate the checked-in snapshot offline and do not require the sibling repo.

The catalogue date appears in People to follow. “My languages” uses the existing
browser, UI and explicit known-language signals. A separate browsing selector offers
every catalogue language and “All languages”; it never writes language preferences.
Legacy sets have no declared content language and remain visible under every filter.
Catalogue titles use UI-locale maps with English fallback. Search prioritizes kits
in known languages. Kit routes include language and slug, so a refresh preserves
links; removed kits show an unavailable message.
