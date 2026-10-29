#!/bin/bash
# YOU run this in your own terminal (not Claude). The transaction PIN is typed at a hidden prompt
# and sent straight to STAGING; it is never written to disk or printed.
#
#   bash staging-crypto-user-steps.sh set-pin           # one-time: set your transaction PIN
#   bash staging-crypto-user-steps.sh confirm <swap_id> # confirm a quoted swap with your PIN
#
# Account: patrick.egbuji@gmail.com on STAGING only. Login password is read from the file below.
set -u
W=https://frontend-web-staging-ec46.up.railway.app
ID='patrick.egbuji@gmail.com'
PWFILE=/private/tmp/claude-501/-Users-paymax-Desktop-wordpress-spotlight-new--claude-worktrees-objective-curie-85dcb1/6b7c200c-b5cc-47f7-97cd-11e79424b807/scratchpad/staging-reset-password.txt
H='Content-Type: application/json'

PW=$(cat "$PWFILE") || { echo "cannot read $PWFILE"; exit 1; }
LOGIN=$(curl -s -m 30 -X POST "$W/api/auth/login" -H "$H" -d "{\"identifier\":\"$ID\",\"password\":\"$PW\"}")
TOKEN=$(echo "$LOGIN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(d.get('access_token') or d.get('accessToken') or (d.get('session') or {}).get('access_token') or (d.get('tokens') or {}).get('accessToken') or '')" 2>/dev/null)
[ -z "$TOKEN" ] && { echo "login failed"; exit 1; }

case "${1:-}" in
  set-pin)
    read -r -s -p "New 4-digit transaction PIN: " PIN; echo
    read -r -s -p "Repeat PIN: " PIN2; echo
    [ "$PIN" = "$PIN2" ] || { echo "PINs differ"; exit 1; }
    curl -s -m 30 -w ' [%{http_code}]\n' -X POST "$W/api/finance/transfers/pin" \
      -H "Authorization: Bearer $TOKEN" -H "$H" -d "{\"pin\":\"$PIN\"}"
    ;;
  confirm)
    SWAP="${2:-}"; [ -z "$SWAP" ] && { echo "usage: confirm <swap_id>"; exit 1; }
    read -r -s -p "Transaction PIN: " PIN; echo
    curl -s -m 60 -w ' [%{http_code}]\n' -X POST "$W/api/v1/crypto/swaps/$SWAP/confirm" \
      -H "Authorization: Bearer $TOKEN" -H "$H" -d "{\"pin\":\"$PIN\"}"
    ;;
  *) echo "usage: $0 set-pin | confirm <swap_id>"; exit 1 ;;
esac
