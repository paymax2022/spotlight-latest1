#!/bin/bash
set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="${1:-spotlight-fintech}"
REGION="${2:-us-central1}"
BACKEND_PORT=8091
ADMIN_PORT=3001
MOBILE_PORT=8083

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    🚀 Deploy Spotlight to Google Cloud Platform${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Project:${NC} $PROJECT_ID"
echo -e "${YELLOW}Region:${NC} $REGION"
echo ""

# Check prerequisites
echo -e "${BLUE}📋 Checking prerequisites...${NC}"
command -v gcloud >/dev/null 2>&1 || { echo -e "${RED}❌ gcloud CLI not installed${NC}"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo -e "${RED}❌ Docker not installed${NC}"; exit 1; }
echo -e "${GREEN}✅ Prerequisites OK${NC}"
echo ""

# Set up gcloud
echo -e "${BLUE}🔐 Configuring gcloud...${NC}"
gcloud config set project $PROJECT_ID
gcloud auth configure-docker gcr.io
export PROJECT_ID=$(gcloud config get-value project)
echo -e "${GREEN}✅ gcloud configured${NC}"
echo ""

# Enable APIs
echo -e "${BLUE}📡 Enabling required APIs...${NC}"
gcloud services enable containerregistry.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable compute.googleapis.com
echo -e "${GREEN}✅ APIs enabled${NC}"
echo ""

# Build and push images
echo -e "${BLUE}🏗️  Building and pushing Docker images...${NC}"
echo ""

# Backend
echo -e "${YELLOW}Building backend...${NC}"
docker build -t gcr.io/$PROJECT_ID/spotlight-backend:latest -f Dockerfile .
echo -e "${YELLOW}Pushing backend...${NC}"
docker push gcr.io/$PROJECT_ID/spotlight-backend:latest
echo -e "${GREEN}✅ Backend pushed${NC}"
echo ""

# Admin
echo -e "${YELLOW}Building admin dashboard...${NC}"
docker build -t gcr.io/$PROJECT_ID/spotlight-admin:latest \
  -f frontend-admin/Dockerfile frontend-admin/
echo -e "${YELLOW}Pushing admin dashboard...${NC}"
docker push gcr.io/$PROJECT_ID/spotlight-admin:latest
echo -e "${GREEN}✅ Admin pushed${NC}"
echo ""

# Mobile
echo -e "${YELLOW}Building mobile web app...${NC}"
docker build -t gcr.io/$PROJECT_ID/spotlight-mobile:latest \
  -f mobile-app/reactnative/Dockerfile mobile-app/reactnative/
echo -e "${YELLOW}Pushing mobile web app...${NC}"
docker push gcr.io/$PROJECT_ID/spotlight-mobile:latest
echo -e "${GREEN}✅ Mobile pushed${NC}"
echo ""

# Deploy to Cloud Run
echo -e "${BLUE}☁️  Deploying to Cloud Run...${NC}"
echo ""

# Backend deployment
echo -e "${YELLOW}Deploying backend...${NC}"
gcloud run deploy spotlight-backend \
  --image gcr.io/$PROJECT_ID/spotlight-backend:latest \
  --region $REGION \
  --port $BACKEND_PORT \
  --memory 2Gi \
  --cpu 2 \
  --allow-unauthenticated \
  --max-instances 10 \
  --min-instances 1 \
  --no-gen2 2>&1 | tail -5
BACKEND_URL=$(gcloud run services describe spotlight-backend \
  --region $REGION --format='value(status.url)')
echo -e "${GREEN}✅ Backend deployed${NC}"
echo "   URL: $BACKEND_URL"
echo ""

# Admin deployment
echo -e "${YELLOW}Deploying admin dashboard...${NC}"
gcloud run deploy spotlight-admin \
  --image gcr.io/$PROJECT_ID/spotlight-admin:latest \
  --region $REGION \
  --port $ADMIN_PORT \
  --memory 1Gi \
  --cpu 1 \
  --allow-unauthenticated \
  --max-instances 10 \
  --min-instances 1 \
  --set-env-vars "NEXT_PUBLIC_API_URL=$BACKEND_URL/api/v1" \
  --no-gen2 2>&1 | tail -5
ADMIN_URL=$(gcloud run services describe spotlight-admin \
  --region $REGION --format='value(status.url)')
echo -e "${GREEN}✅ Admin deployed${NC}"
echo "   URL: $ADMIN_URL"
echo ""

# Mobile deployment
echo -e "${YELLOW}Deploying mobile web app...${NC}"
gcloud run deploy spotlight-mobile \
  --image gcr.io/$PROJECT_ID/spotlight-mobile:latest \
  --region $REGION \
  --port $MOBILE_PORT \
  --memory 512Mi \
  --cpu 1 \
  --allow-unauthenticated \
  --max-instances 5 \
  --min-instances 1 \
  --set-env-vars "EXPO_PUBLIC_API_BASE_URL=$BACKEND_URL/api/v1" \
  --no-gen2 2>&1 | tail -5
MOBILE_URL=$(gcloud run services describe spotlight-mobile \
  --region $REGION --format='value(status.url)')
echo -e "${GREEN}✅ Mobile deployed${NC}"
echo "   URL: $MOBILE_URL"
echo ""

# Summary
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✨ Deployment Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Service URLs:${NC}"
echo -e "  ${BLUE}Backend:${NC}  $BACKEND_URL"
echo -e "  ${BLUE}Admin:${NC}    $ADMIN_URL"
echo -e "  ${BLUE}Mobile:${NC}   $MOBILE_URL"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Verify services are running"
echo "  2. Configure custom domains"
echo "  3. Set environment variables"
echo "  4. Monitor logs: gcloud logging read"
echo "  5. View dashboard: https://console.cloud.google.com"
echo ""
echo -e "${YELLOW}Test Backend:${NC}"
echo "  curl $BACKEND_URL/health"
echo ""
echo -e "${YELLOW}View Logs:${NC}"
echo "  gcloud logging read 'resource.type=cloud_run_revision'"
echo ""
echo -e "${GREEN}🚀 Your Spotlight platform is live on Google Cloud!${NC}"
