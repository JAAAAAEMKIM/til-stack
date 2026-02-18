#!/bin/bash
set -e

echo "=== TIL Stack EC2 Initialization ==="

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Nginx
sudo apt install -y nginx

# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Create application directory
sudo mkdir -p /opt/til-stack
sudo chown $USER:$USER /opt/til-stack

# Create data directory for SQLite
sudo mkdir -p /opt/til-stack/data
sudo chown $USER:$USER /opt/til-stack/data

# Create backup directory
sudo mkdir -p /opt/til-stack/backups
sudo chown $USER:$USER /opt/til-stack/backups

# Configure firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

echo "=== Initialization Complete ==="
echo "Next steps:"
echo "1. Log out and back in for Docker group to take effect"
echo "2. Copy docker-compose.production.yml to /opt/til-stack/"
echo "3. Create .env file with production secrets"
echo "4. Configure Nginx with provided config"
echo "5. Run: sudo certbot --nginx -d til.jaaaaaemkim.com"
