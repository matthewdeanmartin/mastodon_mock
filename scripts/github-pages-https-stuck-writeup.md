# Why your GitHub Pages HTTPS certificate is stuck (when DNS is actually fine)

*A debugging story with a reusable diagnostic script.*

## TL;DR

My custom domain `mawkingbird.com` served fine over **HTTP**, DNS was configured
**exactly** the way GitHub Pages wants, GitHub even reported the domain as
`verified` — and yet **"Enforce HTTPS" stayed greyed out** and the site was being
served with GitHub's shared `*.github.io` certificate instead of a real
Let's Encrypt cert for my domain.

The fix was **not** a DNS change. It was forcing GitHub to *re-request* the
certificate by **removing and re-adding the custom domain** in
`Settings → Pages`. Minutes later the cert provisioned and HTTPS enforcement
turned itself on.

The rest of this post is how to *prove* you're in this exact situation before you
start randomly editing DNS records — and a script that does it for you.

---

## The symptom

- `http://mawkingbird.com/` → **200 OK** ✅
- `https://mawkingbird.com/` → **200 OK**, but the TLS cert served was:

  ```
  Subject : CN=*.github.io
  Issuer  : O=Let's Encrypt
  SANs    : *.github.com, *.github.io, *.githubusercontent.com, github.com, github.io, githubusercontent.com
  ```

  Note what's **missing** from those SANs: `mawkingbird.com`. The origin was
  answering with GitHub's *generic* wildcard cert, not a cert issued **for my
  domain**. Browsers accept it enough to load the page over HTTPS, which is why
  this is so easy to misdiagnose as "working."

- `Settings → Pages` showed the domain as verified but **"Enforce HTTPS" was
  disabled**, with the tooltip about the certificate still being provisioned.

## The trap: assuming it's DNS

Every "GitHub Pages HTTPS won't work" article says *check your DNS*, so that's
where I started. The honest surprise here was that **DNS was already perfect**:

| Record | Expected (GitHub Pages) | What I had |
|---|---|---|
| Apex `A` | `185.199.108.153`–`.111.153` | ✅ all four |
| Apex `AAAA` | `2606:50c0:8000::153`–`8003::153` | ✅ all four |
| `www` `CNAME` | `<user>.github.io` | ✅ `matthewdeanmartin.github.io` |
| `CAA` | none, **or** one authorizing `letsencrypt.org` | ✅ none |
| Pages `domain_state` | `verified` | ✅ `verified` |

When DNS is genuinely correct and the domain is `verified`, but the cert never
shows up, you are in the **"stuck provisioning"** state. GitHub kicks off cert
issuance when you *set* the custom domain; if that first attempt happens before
DNS has fully propagated (or hits a transient hiccup), it can silently fail to
retry. The DNS is now right, but nothing re-triggers issuance.

## The fix

In the repo, go to **Settings → Pages** and:

1. **Remove** the custom domain (clear the field, Save).
2. **Re-add** `mawkingbird.com` (Save).

That re-adds a fresh `CNAME`-triggered request for a Let's Encrypt certificate,
this time against DNS that's already correct. Within minutes the certificate
provisioned and **Enforce HTTPS** enabled itself.

### Before / after (from the GitHub Pages API)

Before — no `https_certificate` object at all, enforcement off:

```json
{ "cname": "mawkingbird.com", "protected_domain_state": "verified",
  "https_enforced": false }
```

After the remove/re-add:

```json
{ "cname": "mawkingbird.com", "protected_domain_state": "verified",
  "https_enforced": true,
  "https_certificate": { "state": "approved",
    "description": "The certificate has been approved." } }
```

You can watch this yourself without opening the browser:

```bash
gh api repos/<owner>/<repo>/pages | \
  jq '{cname, https_enforced, cert: .https_certificate.state}'
```

---

## The diagnostic checklist (what the script checks)

The companion script `scripts/diagnose_pages_dns.ps1` is read-only and walks
through every condition that can block Pages HTTPS, printing `PASS` / `WARN` /
`FAIL` with an explanation. In order of how often they're the culprit:

1. **Apex `A` records** — must be GitHub's four IPs, with **no extra/stale**
   ones. A leftover `A` record pointing at an old host is a classic cert
   blocker (issuance validates *all* addresses the name resolves to).
2. **`AAAA` records** — optional, but if present they must be GitHub's IPv6 set.
   A stray non-GitHub `AAAA` breaks issuance the same way a stray `A` does.
3. **No `CNAME` on the apex** — the root/apex must use `A`/`AAAA` (or your host's
   "CNAME flattening"), never a raw `CNAME`. A `www` subdomain is where the
   `CNAME → <user>.github.io` belongs.
4. **`CAA` records** — the sneakiest one. If *any* `CAA` record exists and it
   does **not** list `letsencrypt.org`, the CA is contractually forbidden from
   issuing and the cert silently never appears. Fix:
   `yourdomain CAA 0 issue "letsencrypt.org"`.
5. **No TLS-terminating proxy in front** — if you're on Cloudflare with the
   record **Proxied** (orange cloud), Cloudflare terminates TLS and GitHub can't
   validate the domain. Set records to **DNS only** (grey cloud) at least until
   the Pages cert provisions.
6. **The cert actually being served** — open a real TLS connection and check the
   issuer/SANs. If the subject is `*.github.io` and your domain isn't in the
   SANs (my exact case), the cert hasn't provisioned for you yet.
7. **Pages API state** — `protected_domain_state: verified`,
   `https_certificate.state: approved`, `https_enforced: true` is the goal.

## A gotcha worth its own paragraph: your resolver may lie

On my machine, outbound **UDP/53 to external resolvers (`1.1.1.1`) was
firewalled**. The first version of the script queried `1.1.1.1` directly to dodge
local DNS cache — and got *nothing back*, which it reported as
`[FAIL] No A records found`. That was a **false negative**: the records were
there all along; my network just couldn't reach the resolver I picked.

Lesson: when a DNS lookup returns *empty*, distinguish "the record doesn't exist"
from "I couldn't reach the resolver." The script now tries the public resolver
first, **falls back to the system resolver**, and prints a `WARN` explaining that
the external resolver was unreachable — so an empty result from a blocked port is
never mistaken for a broken domain.

## Running it

```powershell
pwsh ./scripts/diagnose_pages_dns.ps1
# or:  powershell -ExecutionPolicy Bypass -File ./scripts/diagnose_pages_dns.ps1
```

Optional parameters (defaults are baked in for this repo):

```powershell
pwsh ./scripts/diagnose_pages_dns.ps1 -Domain example.com -RepoOwner me -RepoName my-site
```

It needs PowerShell 5+ (`Resolve-DnsName`). The final Pages-API section also uses
the `gh` CLI if it's installed and authenticated (`gh auth login`); everything
else works without it.

## Checklist you can paste into your own runbook

- [ ] Apex `A` = GitHub's 4 IPs, **nothing extra**
- [ ] `AAAA` absent, or GitHub's 4 IPv6 addresses
- [ ] No `CNAME` on the apex; `www` `CNAME → <user>.github.io`
- [ ] No `CAA`, or a `CAA` authorizing `letsencrypt.org`
- [ ] No proxy terminating TLS (Cloudflare = grey cloud / DNS only)
- [ ] Pages API: `domain_state: verified`
- [ ] If cert still missing → **remove & re-add** the custom domain in
      `Settings → Pages`
- [ ] Confirm served cert issuer = Let's Encrypt and SANs include *your* domain
- [ ] Tick **Enforce HTTPS**

---

*Written after debugging `mawkingbird.com` (the "Mocking Bird" static Mastodon
client for [mastodon_mock](https://github.com/matthewdeanmartin/mastodon_mock),
deployed via GitHub Actions to GitHub Pages). Diagnostic script:
`scripts/diagnose_pages_dns.ps1`.*
