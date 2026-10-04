# Sema — Deployment Guide

Two environments:
| Environment | Branch | Domain                  | Port | Container  |
|-------------|--------|-------------------------|------|------------|
| Live        | main   | sema.sozo.co.ke         | 5001 | sema-live  |
| Test        | test   | test.sema.sozo.co.ke    | 5002 | sema-test  |

---

## How deploys work

Push to `main` → GitHub Actions builds image tagged `:latest` → pushes to ghcr.io → SSHs into VPS → pulls and restarts `sema-live`.

Push to `test` → same flow with tag `:test` → restarts `sema-test`.

---

## One-time VPS setup

SSH into the VPS, then run these commands in order.

### 1. Create project directories

```bash
mkdir -p ~/projects/personal/sema/live
mkdir -p ~/projects/personal/sema/test
```

### 2. Copy compose files

```bash
# From this repo's deploy/ folder, copy to VPS:
scp deploy/docker-compose.live.yml zorro@207.154.192.168:~/projects/personal/sema/live/docker-compose.yml
scp deploy/docker-compose.test.yml zorro@207.154.192.168:~/projects/personal/sema/test/docker-compose.yml
```

### 3. Create env files on the VPS

```bash
# On the VPS:
cp ~/projects/personal/sema/live/docker-compose.yml ~/projects/personal/sema/live/  # already there
nano ~/projects/personal/sema/live/.env.live
```

Fill in `.env.live` (see `.env.live.example` in this folder for the keys needed).
Do the same for `.env.test`.

### 4. Authenticate Docker with ghcr.io

```bash
# On the VPS — generate a GitHub PAT with read:packages scope, then:
echo YOUR_GITHUB_PAT | docker login ghcr.io -u mutisya18 --password-stdin
```

### 5. Pull and start containers

```bash
cd ~/projects/personal/sema/live && docker compose up -d
cd ~/projects/personal/sema/test && docker compose up -d
docker ps
```

### 6. Install nginx configs

```bash
# From your local machine:
scp deploy/nginx-live.conf zorro@207.154.192.168:/tmp/sema-live
scp deploy/nginx-test.conf zorro@207.154.192.168:/tmp/sema-test

# On the VPS:
sudo mv /tmp/sema-live /etc/nginx/sites-available/sema-live
sudo mv /tmp/sema-test /etc/nginx/sites-available/sema-test
sudo ln -s /etc/nginx/sites-available/sema-live /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/sema-test /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 7. Get SSL certificates

Make sure DNS is pointed to the VPS before running certbot.

```bash
sudo certbot --nginx -d sema.sozo.co.ke
sudo certbot --nginx -d test.sema.sozo.co.ke
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Add GitHub Actions secrets

In your GitHub repo → Settings → Secrets and variables → Actions, add:

| Secret        | Value                              |
|---------------|------------------------------------|
| `VPS_HOST`    | `207.154.192.168`                  |
| `VPS_USER`    | `zorro`                            |
| `VPS_SSH_KEY` | Contents of your VPS private key   |

---

## Port register

See `port-register.txt` for the full list of ports in use on the VPS.
