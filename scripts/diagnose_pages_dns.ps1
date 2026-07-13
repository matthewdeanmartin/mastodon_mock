<#
.SYNOPSIS
    Diagnose why GitHub Pages will not issue / serve an HTTPS certificate for a
    custom domain (here: mawkingbird.com).

.DESCRIPTION
    GitHub Pages provisions a Let's Encrypt certificate automatically, but ONLY
    once the custom domain's DNS is configured exactly the way Pages expects AND
    the domain resolves cleanly (no stale/extra records, no CAA block, no
    proxying in front of it). If any of those is off, the cert stays stuck in
    "provisioning" and the "Enforce HTTPS" checkbox is greyed out / unchecked.

    This script checks every one of those conditions and prints PASS / WARN /
    FAIL with an explanation, so you know exactly what to fix in your DNS host.

    Nothing here changes any state -- it is read-only diagnostics.

.NOTES
    Requires: PowerShell 5+ (Resolve-DnsName). gh CLI optional (for Pages API).
    Run:  pwsh ./scripts/diagnose_pages_dns.ps1
      or: powershell -ExecutionPolicy Bypass -File ./scripts/diagnose_pages_dns.ps1
#>

[CmdletBinding()]
param(
    [string]$Domain    = 'mawkingbird.com',
    [string]$RepoOwner = 'matthewdeanmartin',
    [string]$RepoName  = 'mastodon_mock'
)

$ErrorActionPreference = 'Continue'

# ---- GitHub Pages' expected values -------------------------------------------
# Apex (root) domains must point at these four A records (and/or the AAAA set).
$GH_PAGES_A = @('185.199.108.153','185.199.109.153','185.199.110.153','185.199.111.153')
$GH_PAGES_AAAA = @(
    '2606:50c0:8000::153','2606:50c0:8001::153',
    '2606:50c0:8002::153','2606:50c0:8003::153'
)
# The <user>.github.io host a CNAME (for www / sub-domains) should target.
$GH_PAGES_CNAME_TARGET = "$($RepoOwner.ToLower()).github.io"

# ---- pretty output helpers ---------------------------------------------------
$script:fails = 0
$script:warns = 0
function Line { param($c='-') Write-Host ($c * 74) -ForegroundColor DarkGray }
function Head { param($t) Write-Host ''; Line '='; Write-Host "  $t" -ForegroundColor Cyan; Line '=' }
function Pass { param($m) Write-Host "  [PASS] $m" -ForegroundColor Green }
function Warn { param($m) $script:warns++; Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Fail { param($m) $script:fails++; Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Info { param($m) Write-Host "  [info] $m" -ForegroundColor Gray }

function Resolve-Safe {
    # Try the requested public resolver first (bypasses local cache), but on some
    # machines outbound UDP/53 to external resolvers is firewalled -- so if that
    # returns nothing, fall back to the system resolver rather than reporting a
    # false "no records" FAIL.
    param([string]$Name, [string]$Type, [string]$Server)
    $p = @{ Name = $Name; Type = $Type; ErrorAction = 'SilentlyContinue' }
    if ($Server) { $p.Server = $Server; $p.DnsOnly = $true }
    try {
        $r = Resolve-DnsName @p
        if ($r) { return $r }
    } catch { }
    if ($Server) {
        # Fall back to the system resolver (no -Server).
        try { return Resolve-DnsName -Name $Name -Type $Type -ErrorAction SilentlyContinue } catch { return $null }
    }
    return $null
}

# Warn once if the public resolver is unreachable, so the fallback is transparent.
$script:extResolverOk = $true
try {
    if (-not (Resolve-DnsName -Name 'github.io' -Type A -Server '1.1.1.1' -DnsOnly -ErrorAction Stop)) { $script:extResolverOk = $false }
} catch { $script:extResolverOk = $false }

$isApex = ($Domain -notmatch '^www\.') -and (($Domain -split '\.').Count -eq 2)

Write-Host ''
Write-Host "GitHub Pages HTTPS / DNS diagnostics for: $Domain" -ForegroundColor White
Write-Host "Repo: $RepoOwner/$RepoName   (apex domain: $isApex)" -ForegroundColor White
if ($script:extResolverOk) {
    Info "Querying public resolver 1.1.1.1 to avoid local cache."
} else {
    Warn "Cannot reach external resolver 1.1.1.1 (outbound UDP/53 likely firewalled on this machine). Falling back to the SYSTEM resolver -- results may be served from local DNS cache. This is a local network limitation, NOT a problem with the domain."
}

# =============================================================================
Head "1. A records (apex must point at GitHub Pages)"
# =============================================================================
$a = Resolve-Safe -Name $Domain -Type A -Server '1.1.1.1'
$aIps = @($a | Where-Object { $_.Type -eq 'A' } | ForEach-Object { $_.IPAddress })
if (-not $aIps) {
    if ($isApex) { Fail "No A records found for $Domain. Apex needs the 4 GitHub Pages A records." }
    else { Info "No A records (fine for a CNAME-based www/subdomain)." }
} else {
    Info "A records returned: $($aIps -join ', ')"
    $missing = $GH_PAGES_A | Where-Object { $_ -notin $aIps }
    $extra   = $aIps | Where-Object { $_ -notin $GH_PAGES_A }
    if ($missing) { Fail "Missing GitHub Pages A records: $($missing -join ', ')" }
    else          { Pass "All 4 GitHub Pages A records present." }
    if ($extra)   { Fail "EXTRA / stale A records that will break cert issuance: $($extra -join ', '). Remove these." }
}

# =============================================================================
Head "2. AAAA records (optional, but if present must be GitHub's)"
# =============================================================================
$aaaa = Resolve-Safe -Name $Domain -Type AAAA -Server '1.1.1.1'
$aaaaIps = @($aaaa | Where-Object { $_.Type -eq 'AAAA' } | ForEach-Object { $_.IPAddress })
if (-not $aaaaIps) {
    Info "No AAAA records (that's OK)."
} else {
    Info "AAAA records returned: $($aaaaIps -join ', ')"
    $extra6 = $aaaaIps | Where-Object { $_ -notin $GH_PAGES_AAAA }
    if ($extra6) { Fail "Non-GitHub AAAA records present: $($extra6 -join ', '). Remove or replace with GitHub's AAAA set." }
    else         { Pass "AAAA records match GitHub Pages." }
}

# =============================================================================
Head "3. CNAME / flattening check"
# =============================================================================
$cn = Resolve-Safe -Name $Domain -Type CNAME -Server '1.1.1.1'
$cnTargets = @($cn | Where-Object { $_.Type -eq 'CNAME' } | ForEach-Object { $_.NameHost })
if ($isApex -and $cnTargets) {
    Fail "Apex $Domain has a CNAME -> $($cnTargets -join ', '). An apex must use A/AAAA records, NOT a CNAME (unless your host does 'CNAME flattening' to GitHub's IPs). A stray CNAME here blocks cert issuance."
} elseif ($cnTargets) {
    Info "CNAME -> $($cnTargets -join ', ')"
    if ($cnTargets -match [regex]::Escape($GH_PAGES_CNAME_TARGET)) { Pass "CNAME targets $GH_PAGES_CNAME_TARGET." }
    else { Warn "CNAME does not target $GH_PAGES_CNAME_TARGET." }
} else {
    Info "No CNAME at $Domain (expected for an apex using A records)."
}

# Also check the www. variant, since Pages likes both apex and www to resolve.
$wwwName = if ($isApex) { "www.$Domain" } else { $Domain }
$wwwCn = Resolve-Safe -Name $wwwName -Type CNAME -Server '1.1.1.1'
$wwwTgt = @($wwwCn | Where-Object { $_.Type -eq 'CNAME' } | ForEach-Object { $_.NameHost })
$wwwA  = @((Resolve-Safe -Name $wwwName -Type A -Server '1.1.1.1') | Where-Object { $_.Type -eq 'A' } | ForEach-Object { $_.IPAddress })
if ($wwwTgt) { Info "$wwwName CNAME -> $($wwwTgt -join ', ')" }
elseif ($wwwA) { Info "$wwwName A -> $($wwwA -join ', ')" }
else { Warn "$wwwName does not resolve. Add a CNAME '$wwwName' -> '$GH_PAGES_CNAME_TARGET' so both apex and www work." }

# =============================================================================
Head "4. CAA records (can silently block Let's Encrypt)"
# =============================================================================
# GitHub Pages uses Let's Encrypt. If a CAA record exists that does NOT authorize
# letsencrypt.org, the cert issuance is refused by the CA -- a very common cause
# of "stuck provisioning".
$caa = Resolve-Safe -Name $Domain -Type CAA -Server '1.1.1.1'
$caaRecs = @($caa | Where-Object { $_.Type -eq 'CAA' })
if (-not $caaRecs) {
    Pass "No CAA records -> any CA (incl. Let's Encrypt) may issue. Good."
} else {
    $issuers = $caaRecs | ForEach-Object {
        # Resolve-DnsName exposes CAA payload differently across versions; grab whatever is there.
        ($_.PSObject.Properties | Where-Object { $_.Name -match 'Value|Data|Issuer|Record' } | ForEach-Object { $_.Value }) -join ' '
    }
    Info "CAA present: $($issuers -join ' | ')"
    if ($issuers -match 'letsencrypt\.org') { Pass "CAA authorizes letsencrypt.org." }
    else { Fail "CAA records do NOT list letsencrypt.org -> Let's Encrypt cannot issue the Pages cert. Add: `$Domain CAA 0 issue \"letsencrypt.org\"" }
}

# =============================================================================
Head "5. Nameservers / who controls DNS"
# =============================================================================
$ns = Resolve-Safe -Name $Domain -Type NS -Server '1.1.1.1'
$nsHosts = @($ns | Where-Object { $_.Type -eq 'NS' } | ForEach-Object { $_.NameHost })
if ($nsHosts) {
    Info "Nameservers: $($nsHosts -join ', ')"
    if ($nsHosts -match 'cloudflare') {
        Warn "Cloudflare nameservers detected. If the record is 'Proxied' (orange cloud), Cloudflare terminates TLS and GitHub can't validate the domain -> set DNS records to 'DNS only' (grey cloud) while Pages provisions its cert."
    }
} else { Warn "Could not read NS records." }

# =============================================================================
Head "6. Live HTTP/HTTPS behaviour"
# =============================================================================
foreach ($scheme in @('http','https')) {
    $url = "$($scheme)://$Domain/"
    try {
        $r = Invoke-WebRequest -Uri $url -MaximumRedirection 0 -TimeoutSec 15 -SkipCertificateCheck -ErrorAction Stop
        Info "$url -> HTTP $($r.StatusCode)"
    } catch {
        $resp = $_.Exception.Response
        if ($resp) { Info "$url -> HTTP $([int]$resp.StatusCode) $($resp.StatusCode)" }
        else { Warn "$url -> no response: $($_.Exception.Message)" }
    }
}

# Inspect the actual TLS certificate the origin is serving.
Head "7. TLS certificate actually being served"
try {
    $tcp = [System.Net.Sockets.TcpClient]::new()
    $tcp.Connect($Domain, 443)
    $ssl = [System.Net.Security.SslStream]::new($tcp.GetStream(), $false, { $true })
    $ssl.AuthenticateAsClient($Domain)
    $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($ssl.RemoteCertificate)
    Info "Subject : $($cert.Subject)"
    Info "Issuer  : $($cert.Issuer)"
    Info "Valid   : $($cert.NotBefore) .. $($cert.NotAfter)"
    $san = ($cert.Extensions | Where-Object { $_.Oid.FriendlyName -eq 'Subject Alternative Name' })
    if ($san) { Info "SANs    : $($san.Format($false))" }
    if ($cert.Issuer -match "Let's Encrypt|R3|E1|R11") { Pass "Origin is serving a Let's Encrypt cert (GitHub Pages)." }
    elseif ($cert.Subject -match [regex]::Escape($Domain) -or $san.Format($false) -match [regex]::Escape($Domain)) { Pass "Cert covers $Domain." }
    else { Fail "Served cert does NOT match $Domain -- likely a proxy/parking/default cert in front of Pages." }
    $ssl.Dispose(); $tcp.Close()
} catch {
    Fail "Could not complete a TLS handshake to $Domain:443 -> $($_.Exception.Message). If DNS is right, this usually means the cert hasn't provisioned yet (wait up to 24h after DNS is correct) or something is blocking 443."
}

# =============================================================================
Head "8. GitHub Pages config (via gh API, if available)"
# =============================================================================
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    $json = & gh api "repos/$RepoOwner/$RepoName/pages" 2>$null
    if ($LASTEXITCODE -eq 0 -and $json) {
        try {
            $p = $json | ConvertFrom-Json
            Info "cname          : $($p.cname)"
            Info "https_enforced : $($p.https_enforced)"
            Info "status         : $($p.status)"
            if ($p.protected_domain_state) { Info "domain_state   : $($p.protected_domain_state)" }
            if ($p.https_certificate) {
                Info "cert.state     : $($p.https_certificate.state)"
                Info "cert.desc      : $($p.https_certificate.description)"
            }
            if ($p.cname -ne $Domain) { Fail "Pages 'cname' is '$($p.cname)', expected '$Domain'. Set the custom domain in repo Settings > Pages." }
            else { Pass "Pages custom domain = $Domain." }
            if (-not $p.https_enforced) { Warn "https_enforced is false -> 'Enforce HTTPS' isn't on yet (usually because the cert is still provisioning)." }
            if ($p.https_certificate -and $p.https_certificate.state -ne 'approved') {
                Fail "Certificate state = '$($p.https_certificate.state)': $($p.https_certificate.description)"
            }
        } catch { Warn "Could not parse Pages API JSON." }
    } else {
        Warn "gh api repos/$RepoOwner/$RepoName/pages failed (not authed, or Pages not enabled). Run: gh auth login"
    }
} else {
    Info "gh CLI not found; skipping Pages API check."
}

# =============================================================================
Head "SUMMARY"
# =============================================================================
if ($script:fails -gt 0) {
    Write-Host "  $($script:fails) FAIL / $($script:warns) WARN. Fix the FAIL items above first, then in the repo Settings > Pages, remove & re-add the custom domain to force GitHub to re-request the certificate." -ForegroundColor Red
} elseif ($script:warns -gt 0) {
    Write-Host "  0 FAIL / $($script:warns) WARN. DNS looks correct. If HTTPS is still off, it's likely just propagation -- wait up to 24h, or toggle the custom domain in Settings > Pages to kick issuance." -ForegroundColor Yellow
} else {
    Write-Host "  All checks passed. If HTTPS still isn't enforced, remove & re-add the custom domain in Settings > Pages." -ForegroundColor Green
}
Write-Host ''
