#!/bin/bash
set -e

DOMAIN="til.jaaaaaemkim.com"
EMAIL="your-email@example.com"

echo "=== Setting up SSL for $DOMAIN ==="

# Copy Nginx config (HTTP-only version)
sudo cp /opt/til-stack/scripts/nginx/$DOMAIN.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/$DOMAIN.conf /etc/nginx/sites-enabled/

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Get SSL certificate (certbot will modify nginx config automatically)
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $EMAIL

# Test auto-renewal
sudo certbot renew --dry-run

echo "=== SSL Setup Complete ==="
echo "Certificate will auto-renew via systemd timer"
