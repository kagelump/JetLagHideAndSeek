#!/usr/bin/env bash
#
# cloud-build.sh — build (and optionally publish) offline data packs on a
# remote Linux box, triggered from your laptop.
#
# Cloud-agnostic by design: the build runs over plain SSH, so the only
# provider-specific code is provisioning (create box → IP, destroy box),
# isolated behind --provider adapters. Use --host to bring your own box on
# any provider (or a local VM) with zero cloud code.
#
# Flow:
#   1. Provision (or use --host) and wait for SSH.
#   2. Bootstrap toolchain (osmium, Node 22, pnpm, gh) — idempotent.
#   3. Clone canonical master on the box, then rsync your *uncommitted* local
#      changes on top (so a regions.yaml edit you haven't pushed still builds).
#   4. Build + lint with the heap auto-sized to 75% of the box's RAM.
#   5. Publish: blobs → GitHub Release, catalog.json → master (publish.mjs).
#   6. Destroy the box (safe — publish already pushed everything to GitHub).
#
# Auth: pass a GitHub token via the GH_TOKEN env var. It is forwarded to the
# box over the encrypted SSH channel as LC_GH_TOKEN (SendEnv) — never on the
# command line, in shell history, or on the box's disk. A fine-grained PAT
# scoped to this repo with Contents: read & write covers both the Release
# upload and the catalog push. (Requires the box's sshd to AcceptEnv LC_* —
# the Ubuntu default.)
#
# Usage:
#   GH_TOKEN=... data/packs/scripts/cloud-build.sh --region europe-netherlands --host root@1.2.3.4
#   GH_TOKEN=... data/packs/scripts/cloud-build.sh --region europe-netherlands --provider linode
#   GH_TOKEN=... data/packs/scripts/cloud-build.sh --all --provider linode --type g6-dedicated-32
#   data/packs/scripts/cloud-build.sh --region asia-taiwan --host root@1.2.3.4 --no-publish --keep
#
# See data/packs/README.md → "Building in the cloud".

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
REGION=""
ALL=0
HOST=""
PROVIDER=""
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
TAG=""
JOBS="auto" # shard the dissolve across the box's cores; --jobs 1 = sequential
DO_PUBLISH=1
DO_DESTROY=1
REMOTE_DIR="JetLagHideAndSeek"

# Linode provisioning knobs (overridable via flags / env).
LINODE_TYPE="${LINODE_TYPE:-g6-dedicated-16}" # 16 vCPU / 32 GB — verify: linode-cli linodes types
LINODE_REGION="${LINODE_REGION:-us-east}"
LINODE_IMAGE="${LINODE_IMAGE:-linode/ubuntu24.04}"
LINODE_ID=""

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { printf '\033[1;36m[cloud-build]\033[0m %s\n' "$*" >&2; }
die() {
    printf '\033[1;31m[cloud-build] ERROR:\033[0m %s\n' "$*" >&2
    exit 1
}

usage() {
    sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

# Run a script (fed on stdin as a heredoc) on the box, with the GitHub token
# available as $GH_TOKEN/$GITHUB_TOKEN. Extra args are passed positionally.
ssh_run() {
    local args="" a
    for a in "$@"; do args+=" $(printf '%q' "$a")"; done
    ssh -i "$SSH_KEY" \
        -o StrictHostKeyChecking=accept-new \
        -o SendEnv=LC_GH_TOKEN \
        -o ConnectTimeout=10 \
        "$HOST" \
        "export GH_TOKEN=\"\${LC_GH_TOKEN:-}\" GITHUB_TOKEN=\"\${LC_GH_TOKEN:-}\"; unset LC_GH_TOKEN; bash -s --$args"
}

# ─── Argument parsing ────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --region)
            REGION="$2"
            shift 2
            ;;
        --all)
            ALL=1
            shift
            ;;
        --host)
            HOST="$2"
            shift 2
            ;;
        --provider)
            PROVIDER="$2"
            shift 2
            ;;
        --ssh-key)
            SSH_KEY="$2"
            shift 2
            ;;
        --type)
            LINODE_TYPE="$2"
            shift 2
            ;;
        --linode-region)
            LINODE_REGION="$2"
            shift 2
            ;;
        --tag)
            TAG="$2"
            shift 2
            ;;
        --jobs)
            JOBS="$2"
            shift 2
            ;;
        --no-publish)
            DO_PUBLISH=0
            shift
            ;;
        --keep)
            DO_DESTROY=0
            shift
            ;;
        -h | --help) usage 0 ;;
        *) die "Unknown argument: $1 (see --help)" ;;
    esac
done

# ─── Validation ──────────────────────────────────────────────────────────────
[ -n "$REGION" ] || [ "$ALL" = 1 ] || die "Specify --region <id> or --all."
[ -z "$HOST" ] || [ -z "$PROVIDER" ] || die "Use either --host or --provider, not both."
[ -n "$HOST" ] || [ -n "$PROVIDER" ] || die "Specify --host <user@ip> or --provider <linode>."
[ -f "$SSH_KEY" ] || die "SSH key not found: $SSH_KEY (set --ssh-key or \$SSH_KEY)."
command -v rsync >/dev/null || die "rsync not found locally."

if [ "$DO_PUBLISH" = 1 ]; then
    [ -n "${GH_TOKEN:-}" ] || die "GH_TOKEN is required to publish (or pass --no-publish)."
fi

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
REPO_SLUG="$(
    git -C "$ROOT" remote get-url origin 2>/dev/null |
        sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##'
)"
[ -n "$REPO_SLUG" ] || die "Could not determine GitHub repo slug from origin remote."

REGION_ARG="--all"
[ "$ALL" = 1 ] || REGION_ARG="--region $REGION"
TAG_ARG=""
[ -z "$TAG" ] || TAG_ARG="--tag $TAG"
LABEL="${REGION:-all}"

# Forward the token over the encrypted channel only (never argv/history/disk).
export LC_GH_TOKEN="${GH_TOKEN:-}"

# ─── Provider adapters (the only cloud-specific code) ────────────────────────
provision_linode() {
    command -v linode-cli >/dev/null || die "linode-cli not found (pip install linode-cli; then 'linode-cli configure' or set LINODE_CLI_TOKEN)."
    command -v jq >/dev/null || die "jq not found locally (needed to parse linode-cli output)."
    [ -f "${SSH_KEY}.pub" ] || die "Public key ${SSH_KEY}.pub not found (needed for root login)."

    local pw label json
    pw="$(openssl rand -base64 24 2>/dev/null || head -c 18 /dev/urandom | base64)"
    label="packs-build-${LABEL}-$(date +%s)"
    log "Provisioning Linode ($LINODE_TYPE, $LINODE_REGION, $LINODE_IMAGE)..."
    json="$(
        linode-cli linodes create \
            --type "$LINODE_TYPE" \
            --region "$LINODE_REGION" \
            --image "$LINODE_IMAGE" \
            --root_pass "$pw" \
            --label "$label" \
            --authorized_keys "$(cat "${SSH_KEY}.pub")" \
            --json --no-defaults 2>&1
    )" || die "linode-cli create failed:\n$json"

    LINODE_ID="$(echo "$json" | jq -r '.[0].id // empty')"
    local ip
    ip="$(echo "$json" | jq -r '.[0].ipv4[0] // empty')"
    [ -n "$LINODE_ID" ] && [ -n "$ip" ] || die "Could not parse Linode id/ip from:\n$json"
    HOST="root@${ip}"
    log "Created Linode $LINODE_ID → $HOST"
}

destroy_linode() {
    [ -n "$LINODE_ID" ] || return 0
    log "Destroying Linode $LINODE_ID..."
    linode-cli linodes delete "$LINODE_ID" >/dev/null 2>&1 ||
        log "WARN: destroy failed — delete manually: linode-cli linodes delete $LINODE_ID"
}

cleanup() {
    local rc=$?
    if [ "$PROVIDER" = "linode" ] && [ "$DO_DESTROY" = 1 ]; then
        destroy_linode
    elif [ -n "$LINODE_ID" ]; then
        log "Leaving Linode $LINODE_ID up ($HOST). Delete: linode-cli linodes delete $LINODE_ID"
    fi
    exit $rc
}
trap cleanup EXIT

# ─── Provision ───────────────────────────────────────────────────────────────
case "$PROVIDER" in
    "") log "Using existing host: $HOST" ;;
    linode) provision_linode ;;
    *) die "Unknown provider: $PROVIDER (supported: linode, or use --host)." ;;
esac

# ─── Wait for SSH ────────────────────────────────────────────────────────────
log "Waiting for SSH at $HOST..."
ssh_up=0
for _ in $(seq 1 60); do
    if ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new \
        -o ConnectTimeout=5 -o BatchMode=yes "$HOST" true 2>/dev/null; then
        ssh_up=1
        break
    fi
    sleep 5
done
[ "$ssh_up" = 1 ] || die "SSH not reachable at $HOST after ~5 min."
log "SSH is up."

# ─── Bootstrap toolchain (idempotent) ────────────────────────────────────────
log "Bootstrapping toolchain (osmium, Node 22, pnpm, gh)..."
ssh_run <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
SUDO=""; [ "$(id -u)" = 0 ] || SUDO=sudo
need() { command -v "$1" >/dev/null 2>&1; }

if ! need osmium || ! need git || ! need jq || ! need curl; then
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq osmium-tool git curl ca-certificates jq gnupg
fi

if ! need node || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
    $SUDO apt-get install -y -qq nodejs
fi
$SUDO corepack enable || true

if ! need gh; then
    $SUDO mkdir -p -m 755 /etc/apt/keyrings
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | $SUDO tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
    $SUDO chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | $SUDO tee /etc/apt/sources.list.d/github-cli.list >/dev/null
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq gh
fi

git config --global user.name "packs-bot" || true
git config --global user.email "packs-bot@users.noreply.github.com" || true
git config --global --add safe.directory '*' || true
echo "  node $(node -v) | pnpm $(corepack pnpm -v) | osmium $(osmium --version | head -1) | gh $(gh --version | head -1)"
EOF

# ─── Clone canonical master on the box ───────────────────────────────────────
log "Cloning $REPO_SLUG (master) on the box..."
ssh_run <<EOF
set -euo pipefail
gh auth setup-git
rm -rf "$REMOTE_DIR"
git clone --single-branch --branch master "https://github.com/$REPO_SLUG.git" "$REMOTE_DIR"
git -C "$REMOTE_DIR" config user.name "packs-bot"
git -C "$REMOTE_DIR" config user.email "packs-bot@users.noreply.github.com"
EOF

# ─── Overlay local uncommitted changes (modified + untracked, not ignored) ───
CHANGED="$(git -C "$ROOT" ls-files --modified --others --exclude-standard || true)"
if [ -n "$CHANGED" ]; then
    log "Overlaying $(printf '%s\n' "$CHANGED" | grep -c . || true) local change(s) onto the clone..."
    printf '%s\n' "$CHANGED" |
        rsync -az --files-from=- \
            -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new" \
            "$ROOT/" "$HOST:$REMOTE_DIR/"
else
    log "Working tree clean — building canonical master (unpushed commits are NOT included; push them first if needed)."
fi

# ─── Build + lint (+ publish) ────────────────────────────────────────────────
log "Building $REGION_ARG (jobs=$JOBS, publish=$DO_PUBLISH)..."
ssh_run "$REGION_ARG" "$TAG_ARG" "$DO_PUBLISH" "$JOBS" <<'EOF'
set -euo pipefail
REGION_ARG="$1"
TAG_ARG="${2:-}"
PUBLISH="${3:-0}"
JOBS="${4:-1}"

cd ~/JetLagHideAndSeek
corepack pnpm install --frozen-lockfile

# Parent heap = 75% of RAM (headroom for OS/osmium/GEOS). With --jobs > 1 the
# dissolve runs in child processes that cap their own heaps to stay under the
# same RAM budget, so the parent value only governs the non-sharded phases.
HEAP=$(( $(free -m | awk '/^Mem:/{print $2}') * 3 / 4 ))
echo "[cloud-build] heap=${HEAP}MB jobs=${JOBS}"

# shellcheck disable=SC2086
NODE_OPTIONS=--max-old-space-size=$HEAP corepack pnpm data:pack -- $REGION_ARG --jobs $JOBS
# shellcheck disable=SC2086
corepack pnpm data:pack:lint -- $REGION_ARG

if [ "$PUBLISH" = "1" ]; then
    gh auth setup-git
    # shellcheck disable=SC2086
    corepack pnpm data:pack:publish -- $REGION_ARG $TAG_ARG
fi
EOF

log "Done. ${DO_PUBLISH:+Published — run 'git pull' locally to get the updated catalog.}"
[ "$DO_PUBLISH" = 1 ] || log "Built without publishing. Inspect on the box or rsync data/packs/dist down."
