# AWS deployment configuration

The same two images as every other deployment, on ECS Fargate. Nothing here is applied
automatically: these are the definitions and the order of the commands, to be run once per
environment by whoever holds the AWS account.

| File | What it is |
|---|---|
| `api.task-definition.json` | The API task: port 8000, `/health` check, variables, secrets from Secrets Manager, logs to CloudWatch `/nexus/<environment>/api`. |
| `web.task-definition.json` | The web task: port 3000, logs to `/nexus/<environment>/web`. |
| `execution-role-policy.json` | What ECS needs to start a task: pull the images, write the logs, read this environment's secrets. |
| `api-task-role-policy.json` | What the running API may do: read, write and delete documents in this environment's bucket, nothing else. |
| `ecs-tasks-trust-policy.json` | Lets ECS tasks assume the two roles. |

The files carry `${ENVIRONMENT}` (`staging` or `production`), `${ACCOUNT_ID}`, `${AWS_REGION}`,
`${IMAGE_TAG}`, `${WEB_HOST}`, `${DOCUMENT_EXTRACTOR}` and `${BILLING_PROVIDER}`, filled in with
`envsubst` at the moment they are used. Staging may run both on their stand-in (`stub`).
Production may not: with `APP_ENV=production` the API refuses to start unless
`DOCUMENT_EXTRACTOR` is `gemini` or `claude` and `BILLING_PROVIDER` is `stripe`, and the keys
those need (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_*`) are added to the environment's secret and to the `secrets` list of
`api.task-definition.json`.

## The layout

- **ECS Fargate**: one service per image, behind an Application Load Balancer — the API target
  group checks `/health` (it answers 503 when the database is down), the web target group `/login`.
- **RDS for PostgreSQL 17** and **ElastiCache for Redis 7**, in private subnets reachable from the tasks only.
- **S3**: one bucket per environment, `nexus-<environment>-documents`, private, versioning on.
- **CloudWatch Logs**: one log group per container. Every API line is one JSON object with
  `service`, `environment`, `req.id` and — when signed in — `organizationId`, `userId`, `locationId`;
  cookies, the authorization header and the session cookies a response sets are redacted.
- **Secrets Manager**: one secret per environment, `nexus/<environment>/api`, a JSON object whose
  keys are the variable names the task definition reads.

## Order of commands, once per environment

```bash
export ENVIRONMENT=staging ACCOUNT_ID=123456789012 AWS_REGION=eu-central-1 \
       IMAGE_TAG=$(git rev-parse --short HEAD) DOCUMENT_EXTRACTOR=stub BILLING_PROVIDER=stub \
       API_HOST=api.staging.example.com WEB_HOST=staging.example.com

# 1. Image repositories, and both images pushed
aws ecr create-repository --repository-name nexus-api
aws ecr create-repository --repository-name nexus-web
aws ecr get-login-password | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
docker build -t $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/nexus-api:$IMAGE_TAG backend
docker build -t $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/nexus-web:$IMAGE_TAG \
  --build-arg NEXT_PUBLIC_API_URL=https://$API_HOST \
  --build-arg NEXT_PUBLIC_APP_ENV=$ENVIRONMENT \
  --build-arg NEXT_PUBLIC_BUGSNAG_API_KEY= \
  frontend
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/nexus-api:$IMAGE_TAG
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/nexus-web:$IMAGE_TAG

# 2. The documents bucket, private
aws s3api create-bucket --bucket nexus-$ENVIRONMENT-documents \
  --create-bucket-configuration LocationConstraint=$AWS_REGION
aws s3api put-public-access-block --bucket nexus-$ENVIRONMENT-documents \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket nexus-$ENVIRONMENT-documents --versioning-configuration Status=Enabled

# 3. Log groups, with a retention
aws logs create-log-group --log-group-name /nexus/$ENVIRONMENT/api
aws logs create-log-group --log-group-name /nexus/$ENVIRONMENT/web
aws logs put-retention-policy --log-group-name /nexus/$ENVIRONMENT/api --retention-in-days 90
aws logs put-retention-policy --log-group-name /nexus/$ENVIRONMENT/web --retention-in-days 30

# 4. The secret (values generated or copied in, never committed)
aws secretsmanager create-secret --name nexus/$ENVIRONMENT/api --secret-string file://secret.json

# 5. Roles
aws iam create-role --role-name nexus-$ENVIRONMENT-execution \
  --assume-role-policy-document file://deploy/aws/ecs-tasks-trust-policy.json
aws iam put-role-policy --role-name nexus-$ENVIRONMENT-execution --policy-name nexus \
  --policy-document "$(envsubst < deploy/aws/execution-role-policy.json)"
aws iam create-role --role-name nexus-$ENVIRONMENT-api-task \
  --assume-role-policy-document file://deploy/aws/ecs-tasks-trust-policy.json
aws iam put-role-policy --role-name nexus-$ENVIRONMENT-api-task --policy-name documents \
  --policy-document "$(envsubst < deploy/aws/api-task-role-policy.json)"

# 6. Task definitions
aws ecs register-task-definition --cli-input-json "$(envsubst < deploy/aws/api.task-definition.json)"
aws ecs register-task-definition --cli-input-json "$(envsubst < deploy/aws/web.task-definition.json)"
```

Then create the RDS instance, the ElastiCache cluster, the load balancer with its two target
groups and certificates, and the two ECS services — API first, as the rest of
[`DEPLOYMENT.md`](../../DEPLOYMENT.md) describes. The API task applies migrations on start.

`secret.json` holds `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and
`BILLING_WEBHOOK_SECRET`. As a service moves from its stand-in to a real provider, add its key to
the secret, add a matching entry under `secrets` in the task definition, change the provider
variable under `environment`, and register a new revision — see [`PROVIDERS.md`](../../PROVIDERS.md).

## Checking the files without an account

```bash
for f in deploy/aws/*.json; do python3 -m json.tool "$f" > /dev/null && echo "ok $f"; done
```
