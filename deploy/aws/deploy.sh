#!/usr/bin/env bash
# Build the Creatign Ledger image, push it to Amazon ECR and create or update the AWS stack.
#
#   First time:  ADMIN_EMAIL=you@yourcompany.in ./deploy/aws/deploy.sh
#   Updates:     ./deploy/aws/deploy.sh
#
# Needs: AWS CLI v2 signed in to your account (aws configure / aws sso login), Docker, git.
# Optional: AWS_REGION (default ap-south-1, Mumbai), STACK (default creatign-ledger),
#           DB_INSTANCE_CLASS (default db.t4g.micro).
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
STACK="${STACK:-creatign-ledger}"
REPO="${ECR_REPOSITORY:-creatign-ledger}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then TAG="$TAG-$(date +%Y%m%d%H%M%S)"; fi
IMAGE="$REGISTRY/$REPO:$TAG"

echo "==> Account $ACCOUNT, region $REGION, stack $STACK"

# 1. container registry
if ! aws ecr describe-repositories --repository-names "$REPO" >/dev/null 2>&1; then
  echo "==> Creating ECR repository $REPO"
  aws ecr create-repository --repository-name "$REPO" --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE >/dev/null
  aws ecr put-lifecycle-policy --repository-name "$REPO" --lifecycle-policy-text \
    '{"rules":[{"rulePriority":1,"description":"keep the last 15 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":15},"action":{"type":"expire"}}]}' >/dev/null
fi

# 2. build and push (Fargate runs x86_64)
echo "==> Building $IMAGE"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker build --platform linux/amd64 -t "$IMAGE" "$ROOT"
docker push "$IMAGE"

# 3. stack
PARAMS=("ImageUri=$IMAGE")
if aws cloudformation describe-stacks --stack-name "$STACK" >/dev/null 2>&1; then
  [ -n "${ADMIN_EMAIL:-}" ] && PARAMS+=("AdminEmail=$ADMIN_EMAIL")
  [ -n "${DB_INSTANCE_CLASS:-}" ] && PARAMS+=("DbInstanceClass=$DB_INSTANCE_CLASS")
  echo "==> Updating stack $STACK (a few minutes; the app is offline for about a minute while the new version starts)"
else
  if [ -z "${ADMIN_EMAIL:-}" ]; then
    echo "Set ADMIN_EMAIL to the email address of the person who will own this Creatign Ledger, for example:" >&2
    echo "  ADMIN_EMAIL=you@yourcompany.in $0" >&2
    exit 1
  fi
  PARAMS+=("AdminEmail=$ADMIN_EMAIL" "OriginVerifySecret=$(openssl rand -hex 32)")
  [ -n "${DB_INSTANCE_CLASS:-}" ] && PARAMS+=("DbInstanceClass=$DB_INSTANCE_CLASS")
  echo "==> Creating stack $STACK (about 20-30 minutes: the database and CloudFront take the longest)"
fi

aws cloudformation deploy \
  --stack-name "$STACK" \
  --template-file "$HERE/ledger.yml" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${PARAMS[@]}"

URL="$(aws cloudformation describe-stacks --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue" --output text)"
echo
echo "Creatign Ledger is deployed: $URL"
echo "Logs: aws logs tail /ecs/$STACK --follow --region $REGION"
