#!/bin/bash

# Deploy spotlight-mobile to Render
# Usage: RENDER_API_KEY=your_key ./deploy-mobile.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

if [ -z "$RENDER_API_KEY" ]; then
  echo -e "${RED}❌ Error: RENDER_API_KEY not set${NC}"
  echo "Usage: RENDER_API_KEY=your_api_key ./deploy-mobile.sh"
  exit 1
fi

echo -e "${BLUE}📱 Deploying spotlight-mobile to Render${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

# Configuration
REPO="https://github.com/paymax2022/spotlight-latest1"
BRANCH="main"

# Get owner and environment IDs from existing service
echo -e "${YELLOW}📋 Fetching account details...${NC}"
OWNER_ID=$(curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services | jq -r '.[0].service.ownerId')
ENV_ID=$(curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services | jq -r '.[0].service.environmentId')

echo "Owner ID: $OWNER_ID"
echo "Environment ID: $ENV_ID"

# Check if mobile already exists
MOBILE_EXISTS=$(curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services | jq '.[] | select(.service.name == "spotlight-mobile")' 2>/dev/null)

if [ -n "$MOBILE_EXISTS" ]; then
  echo -e "${GREEN}✓ spotlight-mobile already exists${NC}"
  echo "$MOBILE_EXISTS" | jq -r '.service | "  URL: \(.serviceDetails.url)"'
  exit 0
fi

echo -e "${YELLOW}🚀 Creating spotlight-mobile service...${NC}"

# Create service using web endpoint
RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  https://api.render.com/v1/services/web \
  -d @- << 'PAYLOAD'
{
  "name": "spotlight-mobile",
  "repo": "https://github.com/paymax2022/spotlight-latest1",
  "branch": "main",
  "runtime": "node",
  "region": "ohio",
  "plan": "standard",
  "rootDir": "mobile-app/reactnative",
  "buildCommand": "npm install && npm run build:web",
  "startCommand": "npx expo start --web",
  "autoDeploy": true
}
PAYLOAD
)

echo "API Response:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"

# Check if successful
SERVICE_ID=$(echo "$RESPONSE" | jq -r '.id // .service.id // empty' 2>/dev/null)

if [ -n "$SERVICE_ID" ] && [ "$SERVICE_ID" != "null" ]; then
  echo -e "${GREEN}✅ Service created successfully!${NC}"
  echo -e "${GREEN}Service ID: $SERVICE_ID${NC}"
  echo -e "${GREEN}URL will be: https://spotlight-mobile.onrender.com${NC}"
else
  echo -e "${RED}❌ Service creation failed${NC}"
  echo -e "${YELLOW}Trying alternative approach...${NC}"

  # Try using the dashboard directly
  echo -e "${YELLOW}Please deploy manually:${NC}"
  echo "1. Go to: https://dashboard.render.com/new/web-service"
  echo "2. Repository: paymax2022/spotlight-latest1"
  echo "3. Name: spotlight-mobile"
  echo "4. Root Dir: mobile-app/reactnative"
  echo "5. Build: npm install && npm run build:web"
  echo "6. Start: npx expo start --web"
  echo "7. Region: Ohio, Plan: Standard"
  exit 1
fi

echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Deployment initiated!${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}📊 Dashboard: https://dashboard.render.com${NC}"
echo -e "${YELLOW}📱 Mobile App: https://spotlight-mobile.onrender.com${NC}"
echo ""
echo -e "${YELLOW}💡 Build will take 5-10 minutes${NC}"
echo -e "${YELLOW}   Check dashboard for build progress${NC}"
