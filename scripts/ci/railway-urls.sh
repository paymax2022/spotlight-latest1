#!/usr/bin/env bash
# The ONE place a Railway service URL is written down. Sourced by release.yml's
# gate (pre-deploy fingerprints) and by railway-smoke.sh (post-deploy probes), so
# the two can never disagree about which host they are talking about.
#
# Measured 2026-11-15 against project spotlight-platform
# (e7dca861-3667-4d9a-8090-6d2f4d179ec2). Every service in every environment
# reports `source: null`, so a branch push cannot deploy any of them — these hosts
# are written only by `railway up`. ci.yml's header comment claims otherwise; it
# is wrong and Task 7 corrects it.
#
# Usage: railway_url <environment> <service>   -> https URL, or empty
#
# development/frontend-web is included even though its deployment FAILED on
# 2026-11-13: a probe that cannot reach a red host is exactly the evidence that
# says it is still red.

railway_url() {
  case "$1/$2" in
    development/backend)        echo "https://backend-development-502c.up.railway.app" ;;
    development/frontend-admin) echo "https://frontend-admin-development-5a67.up.railway.app" ;;
    development/frontend-web)   echo "https://frontend-web-development.up.railway.app" ;;
    staging/backend)            echo "https://backend-staging-new.up.railway.app" ;;
    staging/frontend-admin)     echo "https://frontend-admin-staging-new.up.railway.app" ;;
    staging/frontend-web)       echo "https://frontend-web-staging-new.up.railway.app" ;;
    production/backend)         echo "https://backend-production-1b33d.up.railway.app" ;;
    production/frontend-admin)  echo "https://frontend-admin-production-5b0c.up.railway.app" ;;
    production/frontend-web)    echo "https://frontend-web-production-9259.up.railway.app" ;;
    *) echo "" ;;
  esac
}
