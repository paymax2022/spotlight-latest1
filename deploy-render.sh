#!/bin/bash

# Render Deployment Script for Spotlight
# Deploys admin dashboard and React Native mobile app to Render
# Usage: RENDER_API_KEY=your_key ./deploy-render.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/paymax2022/spotlight-latest1"
REPO_BRANCH="main"
RENDER_API="https://api.render.com/v1"
REGION="ohio"
PLAN="standard"

# Validate API key
if [ -z "$RENDER_API_KEY" ]; then
  echo -e "${RED}❌ Error: RENDER_API_KEY environment variable not set${NC}"
  echo "Usage: RENDER_API_KEY=your_key ./deploy-render.sh"
  exit 1
fi

echo -e "${BLUE}🚀 Spotlight Render Deployment Script${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

# Function to make API calls
api_call() {
  local method=$1
  local endpoint=$2
  local data=$3

  if [ -z "$data" ]; then
    curl -s -X "$method" \
      -H "Authorization: Bearer $RENDER_API_KEY" \
      -H "Content-Type: application/json" \
      "$RENDER_API$endpoint"
  else
    curl -s -X "$method" \
      -H "Authorization: Bearer $RENDER_API_KEY" \
      -H "Content-Type: application/json" \
      "$RENDER_API$endpoint" \
      -d "$data"
  fi
}

# Get environment ID from existing service
echo -e "${YELLOW}📋 Fetching environment info...${NC}"
SERVICES=$(api_call GET "/services")
ENV_ID=$(echo "$SERVICES" | jq -r '.[0].service.environmentId' 2>/dev/null)

if [ -z "$ENV_ID" ] || [ "$ENV_ID" == "null" ]; then
  echo -e "${RED}❌ Could not fetch environment ID${NC}"
  echo "Services response:"
  echo "$SERVICES" | jq . 2>/dev/null || echo "$SERVICES"
  exit 1
fi

echo -e "${GREEN}✓ Environment ID: $ENV_ID${NC}"

# Display existing services
echo -e "\n${YELLOW}📦 Current Services:${NC}"
echo "$SERVICES" | jq -r '.[] | "  • \(.service.name) (\(.service.serviceDetails.plan) plan) - \(.service.serviceDetails.url)"' 2>/dev/null

# Function to create a web service
create_web_service() {
  local name=$1
  local root_dir=$2
  local build_cmd=$3
  local start_cmd=$4
  local max_instances=$5
  local min_instances=$6
  local env_vars=$7

  echo -e "\n${YELLOW}🔧 Creating service: $name${NC}"

  # Create the service payload
  local payload=$(cat <<EOF
{
  "name": "$name",
  "type": "web_service",
  "runtime": "node",
  "plan": "$PLAN",
  "region": "$REGION",
  "repo": "$REPO_URL",
  "branch": "$REPO_BRANCH",
  "rootDir": "$root_dir",
  "buildCommand": "$build_cmd",
  "startCommand": "$start_cmd",
  "autoDeploy": true,
  "numInstances": 1,
  "environmentId": "$ENV_ID",
  "serviceDetails": {
    "healthCheckPath": "/",
    "healthCheckInterval": 30,
    "numInstances": 1,
    "env": "node"
  },
  "envVars": $env_vars
}
EOF
  )

  # Attempt to create the service
  local response=$(api_call POST "/services" "$payload")

  # Check if creation was successful
  local service_id=$(echo "$response" | jq -r '.id // .service.id // empty' 2>/dev/null)

  if [ -n "$service_id" ] && [ "$service_id" != "null" ]; then
    echo -e "${GREEN}✓ Service created: $service_id${NC}"
    echo -e "${GREEN}✓ Service URL will be: https://$name.onrender.com${NC}"
    return 0
  else
    # If direct creation fails, try alternative endpoint
    echo -e "${YELLOW}⚠ Trying alternative deployment method...${NC}"

    local alt_payload=$(cat <<EOF
{
  "name": "$name",
  "repo": "$REPO_URL",
  "branch": "$REPO_BRANCH",
  "runtime": "node",
  "plan": "$PLAN",
  "region": "$REGION",
  "rootDir": "$root_dir",
  "buildCommand": "$build_cmd",
  "startCommand": "$start_cmd",
  "autoDeploy": true
}
EOF
    )

    local alt_response=$(api_call POST "/services/web" "$alt_payload")
    local alt_id=$(echo "$alt_response" | jq -r '.id // .service.id // empty' 2>/dev/null)

    if [ -n "$alt_id" ] && [ "$alt_id" != "null" ]; then
      echo -e "${GREEN}✓ Service created: $alt_id${NC}"
      echo -e "${GREEN}✓ Service URL will be: https://$name.onrender.com${NC}"
      return 0
    else
      echo -e "${RED}❌ Failed to create service${NC}"
      echo "Response:"
      echo "$response" | jq . 2>/dev/null || echo "$response"
      return 1
    fi
  fi
}

# Deploy spotlight-admin (if not already deployed with correct config)
echo -e "\n${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}📊 SPOTLIGHT ADMIN DASHBOARD${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

ADMIN_ENV_VARS='[
  {
    "key": "NEXT_PUBLIC_API_URL",
    "value": "https://spotlight-latest1.onrender.com/api/v1"
  },
  {
    "key": "NEXT_PUBLIC_ENVIRONMENT",
    "value": "production"
  },
  {
    "key": "NODE_ENV",
    "value": "production"
  }
]'

ADMIN_EXISTS=$(echo "$SERVICES" | jq '.[] | select(.service.name == "spotlight-admin")' 2>/dev/null)

if [ -n "$ADMIN_EXISTS" ]; then
  echo -e "${GREEN}✓ spotlight-admin already deployed${NC}"
  echo "$ADMIN_EXISTS" | jq -r '.service | "  URL: \(.serviceDetails.url)\n  Plan: \(.serviceDetails.plan)\n  Region: \(.serviceDetails.region)"'
else
  echo -e "${YELLOW}Creating spotlight-admin...${NC}"
  create_web_service "spotlight-admin" "frontend-admin" \
    "npm install && npm run build" \
    "npm run start" \
    "2" "1" "$ADMIN_ENV_VARS"
fi

# Deploy spotlight-mobile
echo -e "\n${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}📱 SPOTLIGHT MOBILE (REACT NATIVE)${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

MOBILE_ENV_VARS='[
  {
    "key": "REACT_APP_API_URL",
    "value": "https://spotlight-latest1.onrender.com/api/v1"
  },
  {
    "key": "REACT_APP_ENVIRONMENT",
    "value": "production"
  },
  {
    "key": "NODE_ENV",
    "value": "production"
  }
]'

MOBILE_EXISTS=$(echo "$SERVICES" | jq '.[] | select(.service.name == "spotlight-mobile")' 2>/dev/null)

if [ -n "$MOBILE_EXISTS" ]; then
  echo -e "${GREEN}✓ spotlight-mobile already deployed${NC}"
  echo "$MOBILE_EXISTS" | jq -r '.service | "  URL: \(.serviceDetails.url)\n  Plan: \(.serviceDetails.plan)\n  Region: \(.serviceDetails.region)"'
else
  echo -e "${YELLOW}Creating spotlight-mobile...${NC}"
  create_web_service "spotlight-mobile" "mobile-app/reactnative" \
    "npm install && npm run build:web" \
    "npx expo start --web" \
    "1" "1" "$MOBILE_ENV_VARS" || {
    echo -e "\n${YELLOW}⚠️  Service creation via API encountered limitations.${NC}"
    echo -e "${YELLOW}Please deploy spotlight-mobile manually:${NC}"
    echo -e "${YELLOW}1. Go to: https://dashboard.render.com/new/web-service${NC}"
    echo -e "${YELLOW}2. Select repo: paymax2022/spotlight-latest1${NC}"
    echo -e "${YELLOW}3. Name: spotlight-mobile${NC}"
    echo -e "${YELLOW}4. Root Dir: mobile-app/reactnative${NC}"
    echo -e "${YELLOW}5. Build: npm install && npm run build:web${NC}"
    echo -e "${YELLOW}6. Start: npx expo start --web${NC}"
    echo -e "${YELLOW}7. Plan: Standard, Region: Ohio${NC}"
  }
fi

# Fetch and display final services list
echo -e "\n${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}📋 DEPLOYMENT SUMMARY${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"

FINAL_SERVICES=$(api_call GET "/services")
echo -e "${GREEN}✓ Services Deployed:${NC}"
echo "$FINAL_SERVICES" | jq -r '.[] | "  📦 \(.service.name)\n     URL: \(.service.serviceDetails.url)\n     Plan: \(.service.serviceDetails.plan)\n     Region: \(.service.serviceDetails.region)\n     Status: \(.service.suspended)\n"' 2>/dev/null

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}🔗 Dashboard: https://dashboard.render.com${NC}"
echo -e "${YELLOW}📊 Admin: https://spotlight-admin.onrender.com${NC}"
echo -e "${YELLOW}📱 Mobile: https://spotlight-mobile.onrender.com${NC}"
echo ""
echo -e "${YELLOW}💡 Tips:${NC}"
echo "  • Services will start building immediately"
echo "  • First deployment takes 5-10 minutes"
echo "  • Check dashboard for build logs"
echo "  • Auto-deploy enabled on all services"
echo ""
