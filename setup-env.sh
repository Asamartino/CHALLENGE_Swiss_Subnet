#!/bin/bash

echo "🔧 Setting up environment variables..."

# Determine network
NETWORK=${1:-local}

if [ "$NETWORK" != "local" ] && [ "$NETWORK" != "ic" ]; then
    echo "❓ Network not specified. Using local by default."
    echo "   Usage: ./setup-env.sh [local|ic]"
    NETWORK="local"
fi

# Set host based on network
if [ "$NETWORK" = "ic" ]; then
    HOST="https://ic0.app"
else
    HOST="http://localhost:4943"
fi

echo "🔍 Getting backend canister ID..."
BACKEND_ID=$(dfx canister id swiss_subnet_backend --network $NETWORK)

if [ -z "$BACKEND_ID" ]; then
    echo "❌ Failed to get backend canister ID"
    exit 1
fi

echo "✅ Backend Canister ID: ${BACKEND_ID}"

# Create .env file with correct variable names
echo "📝 Creating src/swiss_subnet_frontend/.env..."
cat > src/swiss_subnet_frontend/.env << EOF
# Auto-generated environment configuration
# Generated on: $(date)
# Network: ${NETWORK}
VITE_DFX_NETWORK=${NETWORK}
VITE_HOST=${HOST}
VITE_CANISTER_ID_SWISS_SUBNET_BACKEND=${BACKEND_ID}
EOF

echo "✅ Environment file created successfully!"
echo "📋 Configuration:"
echo "   Network: ${NETWORK}"
echo "   Host: ${HOST}"
echo "   Backend Canister ID: ${BACKEND_ID}"
echo "🚀 You can now run your frontend!"