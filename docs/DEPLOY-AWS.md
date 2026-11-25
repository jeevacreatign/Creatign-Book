# Deploying Creatign Ledger on AWS

This guide puts Creatign Ledger on AWS with its data in Amazon RDS for MySQL. One command builds the app and creates everything. The app gets a free HTTPS address like `https://d1234abcd.cloudfront.net`. Setting up your own domain is a separate step, done later.

## What gets created

```
 Browser ──HTTPS──► CloudFront ──► Load balancer ──► ECS Fargate task ──TLS──► RDS MySQL 8.4
                    (free *.cloudfront.net      (only accepts          (React app + API,       (private subnets,
                     certificate, caches         CloudFront traffic)     one copy)                no internet access)
                     /assets/*)                                              │
                                                                             └──► EFS (attachments, receipts)
```

All of it is defined in [`deploy/aws/ledger.yml`](../deploy/aws/ledger.yml), a CloudFormation stack.

| Part | What it does |
| --- | --- |
| **CloudFront** | Serves the app over HTTPS and caches the built JavaScript and CSS. It sends a secret header to the load balancer. |
| **Load balancer** | Refuses any request without that secret header, so nobody can get around CloudFront. It also checks `/api/health`. |
| **ECS Fargate** | Runs the app's Docker image (see the [`Dockerfile`](../Dockerfile)). Exactly one copy runs, because the app keeps the books in memory. |
| **RDS MySQL 8.4** | The database. It has encrypted storage, TLS is required, it isn't reachable from the internet, it keeps 7 days of automatic backups, and it has deletion protection. When the stack is deleted, a final snapshot is taken. |
| **EFS** | A shared disk for uploaded attachments. It is encrypted, backed up, and kept even if the stack is deleted. |
| **Secrets Manager** | Holds the database password and the `APP_SECRET` encryption key. Both are generated for you, and nobody has to type them. |
| **CloudWatch Logs** | Keeps the app logs for 30 days. |

The rough cost in Mumbai (ap-south-1) with the default sizes is **US$65–75 a month (about ₹5,500–6,500)**. That is roughly:

* Fargate about $18
* Load balancer about $20
* RDS `db.t4g.micro` with 20 GB about $16
* Public IPv4 addresses about $11
* EFS, CloudFront, secrets and logs, a few dollars

You can check these figures with the [AWS Pricing Calculator](https://calculator.aws/).

## Before you start

1. **An AWS account** and a user that can create the services above. AdministratorAccess is simplest for the first setup.
2. **[AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)**, signed in with `aws configure`, or `aws sso login` if you use IAM Identity Center. Check it with `aws sts get-caller-identity`.
3. **[Docker](https://docs.docker.com/get-docker/)** running on your computer.
4. This repository checked out, with `git pull` done.

## 1. Deploy

From the project folder:

```bash
ADMIN_EMAIL=you@yourcompany.in ./deploy/aws/deploy.sh
```

* `ADMIN_EMAIL` is the owner's email address. Only this address can create the first Admin account on the new site, so a stranger who finds the address first can't take it over.
* The default region is Mumbai. For another region, add `AWS_REGION=ap-southeast-1` (or any other region).
* The first run takes **20–30 minutes**. Most of that time is spent creating the database and the CloudFront distribution.
* At the end the script prints the address, for example `https://d1234abcd.cloudfront.net`.

On Windows, run the script from **Git Bash** or **WSL**.

## 2. Bring your books across, or start fresh

**Starting fresh:** open the address, choose **Sign up**, and use the `ADMIN_EMAIL` address. You become the Admin.

**Moving existing books:** the full `server/data/db.json` from your computer has everyone's sign-ins. Run:

```bash
./deploy/aws/import.sh server/data/db.json
```

The script asks you to type `REPLACE`, then does four things:

1. Stops the app.
2. Uploads the file to a private S3 bucket. The file is deleted from S3 afterwards, and the bucket also deletes anything older than a day.
3. Runs a one-off task that imports the file into RDS.
4. Starts the app again.

Everyone then signs in with their old passwords.

If your books are already in a local MySQL database instead, export them first. Run `npm run dev`, then use **Settings → Data & Backup → Download Backup (JSON)**. That file leaves out passwords on purpose, so after importing it, each person uses **Forgot password**. Email has to be set up in Settings first for that to work.

## 3. After deploying

* **Email:** set up SMTP in **Settings → Emails**. The SMTP password is encrypted with the `APP_SECRET` kept in Secrets Manager.
* **Customer portal links** use the CloudFront address automatically (`APP_ORIGIN`).
* **Gmail linking (OAuth):** add `https://<your address>/api/mail/google/callback` as a redirect URI in Google Cloud, and add the client ID and secret to the task. It is easier to wait until your own domain is set up.

## Updating to a new version

```bash
git pull
./deploy/aws/deploy.sh
```

This builds a new image, tagged with the git commit, and rolls it out. The old copy stops before the new one starts, so the app is **offline for about a minute** during an update. That is deliberate: two copies must never write to the same database. If the new version fails its health checks, ECS rolls back to the previous one automatically.

## Day to day

| Task | Command or place |
| --- | --- |
| Follow the logs | `aws logs tail /ecs/creatign-ledger --follow --region ap-south-1` |
| Restart the app | `aws ecs update-service --cluster creatign-ledger --service app --force-new-deployment --region ap-south-1` |
| Open a shell in the running app | `aws ecs execute-command --cluster creatign-ledger --task <task id> --container app --interactive --command sh` (needs the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)) |
| Database backups | RDS console → Databases → `creatign-ledger-db` → Maintenance & backups. Daily automatic snapshots are kept for 7 days. Take a manual snapshot before big changes. |
| Restore a backup | Restore the snapshot to a new RDS instance. Then point the stack at it, or import from it. |
| Bigger database | `DB_INSTANCE_CLASS=db.t4g.small ./deploy/aws/deploy.sh`. RDS restarts during the change. |
| Database password | Secrets Manager → `creatign-ledger/database`. Don't rotate it while the app is running. If you change it, also change it on the RDS instance, then restart the app. |

## Settings the app reads on AWS

The stack sets all of these. They are listed so you can run the same image somewhere else.

| Variable | Value on AWS | Meaning |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME` | RDS endpoint | Where the database is. Use these or `DATABASE_URL`. |
| `DB_USER`, `DB_PASSWORD` | from Secrets Manager | Database login |
| `DATABASE_SSL` | `rds` | Connect with TLS and check the server against the Amazon RDS certificates. `true` uses the system certificates instead. |
| `ADMIN_EMAIL` | your address | Only this email can create the first Admin account |
| `SEED_SAMPLES` | `false` | Start with no sample clients or invoices |
| `TRUST_PROXY` | `2` | Read the visitor's IP address through CloudFront and the load balancer. Sign-in rate limits use it. |
| `COOKIE_SECURE` | `1` | Sign-in cookies are sent over HTTPS only |
| `APP_ORIGIN` | CloudFront address | Used for links in emails and the customer portal |
| `APP_SECRET` | from Secrets Manager | Encrypts passwords saved in Settings |
| `UPLOAD_DIR` | `/data/uploads` (EFS) | Where attachments are stored |

## Removing it

`aws cloudformation delete-stack --stack-name creatign-ledger` removes most of the stack. Three things are kept on purpose:

* RDS has **deletion protection**. Turn it off in the RDS console first. RDS then leaves a final snapshot.
* The **EFS** file system is kept.
* The **ECR** images are kept.

Delete those by hand when you are sure you no longer need them.
