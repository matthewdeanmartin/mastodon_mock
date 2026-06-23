# Deploy to PythonAnywhere

PythonAnywhere is the odd one out: no Docker, and its web apps are **WSGI**, while
`mastodon_mock` is an **ASGI** (FastAPI) app. You can still host it by wrapping the ASGI
app in a WSGI adapter — with one important limitation.

!!! warning "Streaming is not supported here"
    The WSGI bridge cannot do long-lived streaming responses, so the **streaming
    endpoints (SSE `/api/v1/streaming/*` and the WebSocket multiplex) will not work**
    under PythonAnywhere. Everything else (timelines, posting, auth, admin) works.
    If you need streaming, use a container platform (Render / Railway / Koyeb) instead.

## Steps

1. **Open a Bash console** on PythonAnywhere and create a virtualenv:

   ```bash
   mkvirtualenv mastodon-mock --python=python3.11
   pip install mastodon_mock a2wsgi
   ```

   (`a2wsgi` provides the ASGI→WSGI adapter.)

2. **Initialize a file-backed database** in your home directory so data persists:

   ```bash
   mastodon_mock db upgrade --config ~/.mastodon_mock.toml   # if you use a config file
   # or just let the server create the SQLite file on first run.
   ```

3. **Add a Web app**: Web tab → *Add a new web app* → *Manual configuration* → your
   Python version. Note the path to its WSGI file (e.g.
   `/var/www/<you>_pythonanywhere_com_wsgi.py`).

4. **Edit that WSGI file** to expose the wrapped app. Replace its contents with:

   ```python
   from a2wsgi import ASGIMiddleware
   from mastodon_mock.app import create_app
   from mastodon_mock.config import MastodonMockConfig

   # Use a persistent, file-backed DB in your home directory.
   config = MastodonMockConfig.load()  # reads ~/.mastodon_mock.toml or defaults
   config.database.path = "/home/<you>/mock.sqlite"

   application = ASGIMiddleware(create_app(config))
   ```

   Replace `<you>` with your PythonAnywhere username.

5. **Set the virtualenv** in the Web tab (point it at the `mastodon-mock` virtualenv), then
   **Reload** the web app.

6. Visit `https://<you>.pythonanywhere.com/api/v2/instance` to confirm it's up, and
   `https://<you>.pythonanywhere.com/_ui/` for the bundled UI.

## Notes

- PythonAnywhere serves over HTTPS on your `*.pythonanywhere.com` domain, which keeps
  OAuth redirects and real-client connections happy.
- There is no `$PORT` here — PythonAnywhere routes to the WSGI callable directly, so the
  bind-address handling in `serve` is not used.
- Free accounts can only make outbound network calls to a whitelist, but the mock makes no
  outbound calls, so that does not affect it.
