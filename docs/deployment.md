# Production Deployment

This project is designed to run as one Node process that serves both the PWA and the CAS API on the same origin. On an Ubuntu server, the simplest production shape is:

1. Build the frontend and server once.
2. Run the Node server under `systemd`.
3. Put `nginx` in front.
4. Restrict ingress to Tailscale on the laptop host, or use normal public TLS on a VPS.

## Recommended layout

- App checkout: `/opt/jetlag-hide-and-seek`
- Runtime data: `/var/lib/jetlag-hide-and-seek`
- Tailnet entrypoint: `nginx` on `8080` locally, then Tailscale Serve for HTTPS
- App bind address: `127.0.0.1:8787`

The app should serve:

- `/JetLagHideAndSeek/` for the frontend
- `/api/cas/*` and `/api/teams/*` for state sharing

## Build and install

```bash
sudo mkdir -p /opt/jetlag-hide-and-seek
sudo chown "$USER":"$USER" /opt/jetlag-hide-and-seek
git clone <repo-url> /opt/jetlag-hide-and-seek
cd /opt/jetlag-hide-and-seek
pnpm install
pnpm --dir server install
pnpm build:all
```

Prepare the data directory:

```bash
sudo mkdir -p /var/lib/jetlag-hide-and-seek
sudo chown www-data:www-data /var/lib/jetlag-hide-and-seek
```

## systemd

Use [`server/systemd/jetlag-cas.service`](../server/systemd/jetlag-cas.service) as the base unit.

It already sets:

- `CAS_DATA_DIR=/var/lib/jetlag-hide-and-seek`
- `CAS_STATIC_DIR=/opt/jetlag-hide-and-seek/dist`
- `CAS_STATIC_PREFIX=/JetLagHideAndSeek/`
- `CAS_HOST=127.0.0.1`

Install it:

```bash
sudo cp server/systemd/jetlag-cas.service /etc/systemd/system/jetlag-hide-and-seek.service
sudo systemctl daemon-reload
sudo systemctl enable --now jetlag-hide-and-seek
sudo systemctl status jetlag-hide-and-seek
```

## nginx

Use [`deploy/nginx/jetlag-hide-and-seek.conf`](../deploy/nginx/jetlag-hide-and-seek.conf) as the starting point.

It proxies the whole site to `127.0.0.1:8787`, so the Node process never needs to be publicly reachable.

For a Tailscale-only laptop, pair that config with `tailscale serve` so the tailnet-facing HTTPS endpoint forwards to the local nginx listener. For a public VPS, change the `listen` stanza to `443 ssl` and add your normal TLS certificate paths.

Example install:

```bash
sudo cp deploy/nginx/jetlag-hide-and-seek.conf /etc/nginx/sites-available/jetlag-hide-and-seek.conf
sudo ln -s /etc/nginx/sites-available/jetlag-hide-and-seek.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Tailscale-only exposure on Ubuntu

If the machine should be reachable only over Tailnet, keep `nginx` on `127.0.0.1:8080` and publish that local listener through Tailscale Serve. No public ports need to be opened on the host.

This keeps the app reachable from Tailnet clients while avoiding public internet exposure entirely.

## VPS portability

The same service layout works on a VPS with only the edge layer changed:

- keep the `systemd` unit and Node process exactly the same
- keep `CAS_STATIC_DIR` pointing at the built `dist/` directory
- change the nginx listener to a public `443 ssl` server block
- attach normal public TLS certificates and firewall rules
- optionally move `CAS_HOST` back to `0.0.0.0` if you want the app reachable without a local proxy

## Upgrade flow

```bash
cd /opt/jetlag-hide-and-seek
git pull
pnpm install
pnpm build:all
sudo systemctl restart jetlag-hide-and-seek
sudo systemctl reload nginx
```

## Health checks

- `GET /api/cas/health` should return `{ ok: true, version: "1", ... }`
- `/JetLagHideAndSeek/` should load the PWA assets
- creating a shared snapshot should survive a service restart
