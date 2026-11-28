#!/usr/bin/env bash
# Save the exchange-rate API keys in AWS Secrets Manager (secret <stack>/rate-keys) and restart the app
# so it reads them. The keys are typed at a hidden prompt: they are not shown, not saved in your shell
# history and never written to the repository.
#
#   ./deploy/aws/set-rate-keys.sh
#
# Press Enter at a prompt to keep that key as it is; type "-" to clear it.
# Needs: AWS CLI v2 signed in to your account, Node.js. Run ./deploy/aws/deploy.sh once first (it creates
# the secret). Optional: AWS_REGION (default ap-south-1), STACK (default creatign-ledger).
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
STACK="${STACK:-creatign-ledger}"
SECRET="$STACK/rate-keys"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

if ! CURRENT="$(aws secretsmanager get-secret-value --secret-id "$SECRET" --query SecretString --output text 2>/dev/null)"; then
  echo "Secret $SECRET not found in $REGION. Run ./deploy/aws/deploy.sh first (it creates it)." >&2
  exit 1
fi

read -rsp "Open Exchange Rates App ID (OPENEXCHANGERATES_APP_ID; Enter keeps the current one): " OXR; echo
read -rsp "FRED API key (FRED_API_KEY; Enter keeps the current one): " FRED; echo

TMP="$(mktemp)"
chmod 600 "$TMP"
trap 'rm -f "$TMP"' EXIT
# merge on stdin/env so the keys never appear on a command line
CURRENT="$CURRENT" OXR="$OXR" FRED="$FRED" node -e '
  const cur = JSON.parse(process.env.CURRENT || "{}");
  // "not-set" (the placeholder the stack creates) means no key; an empty value could stop the task starting
  const pick = (typed, old) => (typed === "-" ? "not-set" : typed.trim() || old || "not-set");
  const next = { OPENEXCHANGERATES_APP_ID: pick(process.env.OXR, cur.OPENEXCHANGERATES_APP_ID), FRED_API_KEY: pick(process.env.FRED, cur.FRED_API_KEY) };
  if (/\s/.test(next.OPENEXCHANGERATES_APP_ID + next.FRED_API_KEY)) { console.error("A key contains a space: check what you pasted."); process.exit(1); }
  require("fs").writeFileSync(process.argv[1], JSON.stringify(next));
  for (const [k, v] of Object.entries(next)) console.log(`${k}: ${v !== "not-set" ? "set (" + v.length + " characters)" : "not set"}`);
' "$TMP"

aws secretsmanager put-secret-value --secret-id "$SECRET" --secret-string "file://$TMP" >/dev/null
echo "==> Saved in Secrets Manager ($SECRET). Restarting the app so it reads them (offline for about a minute)..."
aws ecs update-service --cluster "$STACK" --service app --force-new-deployment >/dev/null
echo "Done. When the app is back, open Settings > Currencies and press Refresh Rates."
