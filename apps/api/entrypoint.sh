#!/bin/sh
set -e

# Run migrations
echo "Running database migrations..."
node dist/db/migrate.js

# Start server
echo "Starting API server..."
exec node dist/index.js
