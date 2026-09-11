# Bundled lite UI

This Angular client exercises the `mastodon_mock` REST API, mock login, sample
creation, fault injection, and administration. Standalone Mawkingbird product
work belongs in `../mawkingbird`.

## Build and run

From the repository root, with Node and npm installed:

```bash
uv run make ui
uv run mastodon_mock serve --in-memory --demo
```

Open `http://127.0.0.1:3000/_ui/`. Angular emits the production bundle into
`mastodon_mock/_ui_dist/browser`; the Python wheel packages those compiled files.
The sdist includes source and lockfile, never `node_modules`.

## Development

Keep the Python server running and use a second terminal at the repository root:

```bash
uv run make ui-dev
```

This watches and rebuilds the UI into the same directory served by Python.
Reload the browser after a build. All mock API requests stay on the same origin.
The raw `npm start` Angular server has no API proxy and is not the integrated
mock-server development path.

## Tests

From `ui/`:

```bash
make test
npm test -- --watch=false --include=src/app/pages/home/home.spec.ts
```

The first command runs the complete suite; the second is targeted feedback.
See [the rollback notes](https://github.com/matthewdeanmartin/mastodon_mock/blob/main/ui/ROLLBACK.md)
for the source baseline and dependency refresh history.
