#!/bin/bash

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🚀 Starting PocketIC server...${NC}"

# Start PocketIC in background
pocket-ic > /tmp/pocket-ic-$$.log 2>&1 &
PIC_PID=$!

# Wait for server to start
sleep 3

# Extract port from log
PORT=$(grep -oP 'port \K\d+' /tmp/pocket-ic-$$.log 2>/dev/null || echo "")

if [ -z "$PORT" ]; then
    echo -e "${RED}❌ Failed to start PocketIC server${NC}"
    cat /tmp/pocket-ic-$$.log
    kill $PIC_PID 2>/dev/null || true
    rm -f /tmp/pocket-ic-$$.log
    exit 1
fi

echo -e "${GREEN}✅ PocketIC server running on port $PORT (PID: $PIC_PID)${NC}"

# Function to cleanup on exit
cleanup() {
    echo -e "${YELLOW}🧹 Stopping PocketIC server...${NC}"
    kill $PIC_PID 2>/dev/null || true
    wait $PIC_PID 2>/dev/null || true
    rm -f /tmp/pocket-ic-$$.log
    echo -e "${GREEN}✅ Cleanup complete${NC}"
}

# Set trap to cleanup on script exit
trap cleanup EXIT INT TERM

# Run tests with the dynamic port
echo -e "${YELLOW}🧪 Running tests...${NC}"
cd "$(dirname "$0")"
POCKET_IC_SERVER_URL=http://127.0.0.1:$PORT npm test

# Capture test result
TEST_RESULT=$?

if [ $TEST_RESULT -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
else
    echo -e "${RED}❌ Tests failed with exit code $TEST_RESULT${NC}"
fi

exit $TEST_RESULT