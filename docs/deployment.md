# TIL Stack Deployment Guide

## Prerequisites
- EC2 instance (Ubuntu 22.04 LTS recommended)
- Domain pointing to EC2 IP (til.jaaaaaemkim.com)
- GitHub repository access
- GHCR_TOKEN (GitHub Personal Access Token with `read:packages` scope)

## Initial Server Setup

1. SSH into your EC2 instance
2. Clone the repository:
   ```bash
   git clone https://github.com/your-username/til-stack.git /opt/til-stack
   ```

3. Run initialization:
   ```bash
   cd /opt/til-stack
   chmod +x scripts/ec2-init.sh
   ./scripts/ec2-init.sh
   ```

4. Log out and back in (for Docker group)

5. Create environment file:
   ```bash
   cp .env.production.template .env
   nano .env  # Fill in secrets
   ```

6. Start the application:
   ```bash
   docker-compose -f docker-compose.production.yml up -d
   ```

7. Set up SSL:
   ```bash
   chmod +x scripts/setup-ssl.sh
   ./scripts/setup-ssl.sh
   ```

## GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `EC2_HOST` | EC2 public IP or hostname |
| `EC2_USER` | SSH username (ubuntu) |
| `EC2_SSH_KEY` | Private SSH key content |
| `GHCR_TOKEN` | GitHub PAT with `read:packages` scope (for EC2 to pull images) |

**IMPORTANT**: `GITHUB_TOKEN` only works within GitHub Actions runner. EC2 needs a separate PAT (`GHCR_TOKEN`) to authenticate with GHCR.

### Creating GHCR_TOKEN

1. Go to GitHub Settings > Developer Settings > Personal Access Tokens > Tokens (classic)
2. Create new token with `read:packages` scope
3. Add as repository secret named `GHCR_TOKEN`

## Google OAuth Setup

Update Google Cloud Console with production redirect URI:
- Add `https://til.jaaaaaemkim.com/auth/callback` to authorized redirect URIs

## Backup Procedures

### Manual Backup
```bash
docker exec til-api cat /data/til.db > /opt/til-stack/backups/til-$(date +%Y%m%d).db
```

### Automated Backup (cron)
```bash
0 2 * * * docker exec til-api cat /data/til.db > /opt/til-stack/backups/til-$(date +\%Y\%m\%d).db
```

## Rollback

To rollback to a previous version:
```bash
cd /opt/til-stack
export API_IMAGE=ghcr.io/your-username/til-stack/api:<previous-sha>
export WEB_IMAGE=ghcr.io/your-username/til-stack/web:<previous-sha>
docker-compose -f docker-compose.production.yml up -d
```

## Troubleshooting

### Check container logs
```bash
docker logs til-api
docker logs til-web
```

### Check health status
```bash
curl http://localhost:3001/health
curl http://localhost:8080
```

### Restart services
```bash
docker-compose -f docker-compose.production.yml restart
```

### Verify Nginx proxy
```bash
# Test API proxy
curl -v http://localhost/api/health

# Should see: /health in API logs (not /api/health)
docker logs til-api --tail 10

# Test OAuth callback goes to frontend (should return HTML, not 404)
curl -v http://localhost/auth/callback
```

## DNS Configuration

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | til | <EC2_PUBLIC_IP> | 300 |

## Security Checklist

- [ ] SSH key-based authentication only (disable password auth)
- [ ] UFW firewall enabled with only SSH and Nginx allowed
- [ ] Environment variables stored in `.env` file (not in repo)
- [ ] GitHub Secrets used for CI/CD sensitive data
- [ ] SSL/TLS enforced (HTTP redirects to HTTPS)
- [ ] Security headers added via Nginx
- [ ] Regular security updates: `sudo apt update && sudo apt upgrade`
