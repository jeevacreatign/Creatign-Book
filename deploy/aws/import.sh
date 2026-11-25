#!/usr/bin/env bash
# Copy existing books into the RDS database of a deployed stack, REPLACING what is there.
#
#   ./deploy/aws/import.sh server/data/db.json
#
# Use the full db.json from your computer (it keeps everyone's passwords), not the
# "Download Backup (JSON)" file, which leaves passwords out on purpose.
# The app is stopped while the import runs (about 2-3 minutes) and started again afterwards.
set -euo pipefail

FILE="${1:-}"
REGION="${AWS_REGION:-ap-south-1}"
STACK="${STACK:-creatign-ledger}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
[ -f "$FILE" ] || { echo "Usage: $0 path/to/db.json" >&2; exit 1; }

out() { aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
CLUSTER="$(out ClusterName)"; SERVICE="$(out ServiceName)"; FAMILY="$(out TaskDefinitionFamily)"
SUBNETS="$(out AppSubnets)"; SG="$(out AppSecurityGroup)"; BUCKET="$(out ImportBucket)"

read -r -p "This replaces ALL books in the '$STACK' database with $FILE. Type REPLACE to continue: " ok
[ "$ok" = "REPLACE" ] || { echo "Stopped, nothing changed."; exit 1; }

KEY="imports/$(date +%Y%m%d%H%M%S)-db.json"
aws s3 cp "$FILE" "s3://$BUCKET/$KEY" --only-show-errors
LINK="$(aws s3 presign "s3://$BUCKET/$KEY" --expires-in 1800)"

echo "==> Stopping the app"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --desired-count 0 >/dev/null
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"

restart() {
  echo "==> Starting the app"
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --desired-count 1 >/dev/null
  aws s3 rm "s3://$BUCKET/$KEY" --only-show-errors || true
}
trap restart EXIT

echo "==> Importing"
OVERRIDES="$(printf '{"containerOverrides":[{"name":"app","command":["node","--import","tsx","server/import-json.ts","%s","--force"]}]}' "$LINK")"
TASK="$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$FAMILY" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --overrides "$OVERRIDES" --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
CODE="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)"
aws logs tail "/ecs/$STACK" --since 15m --format short | grep -A20 "Imported" || true
if [ "$CODE" != "0" ]; then
  echo "The import failed (exit code $CODE). See: aws logs tail /ecs/$STACK --since 15m" >&2
  exit 1
fi
echo "==> Import finished"
