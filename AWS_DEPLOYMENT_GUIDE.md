# Nuxt to AWS ECS: Friendly Step-by-Step Guide

This file explains everything we set up, from the start, in plain language.

---

## 1) Goal

Deploy your Nuxt app automatically to AWS ECS whenever you push to `main`.

Pipeline flow:

1. Build app
2. Run tests
3. Build Docker image
4. Push image to Amazon ECR
5. Update and deploy ECS task definition

---

## 2) Project Files We Added/Updated

### `.github/workflows/aws.yml`

Your GitHub Actions pipeline.

It now has **separate jobs**:

- `build` -> installs deps and runs `yarn build`
- `test` -> installs deps and runs `yarn test`
- `deploy` -> logs in to AWS, pushes image to ECR, deploys to ECS

`deploy` only runs if `build` and `test` succeed.

### `.aws/task-definition.json`

ECS task definition is a JSON "run plan" for your app container.  
Think of it as instructions ECS follows every time it starts your app.

It answers questions like:

- Which Docker image should run?
- How much CPU/memory should it get?
- Which port does the app listen on?
- Which IAM roles can the container use?
- Where should logs be written?

In your file, the important parts are:

- `family: nuxt-app-task`  
  This is the task definition name group. ECS keeps revisions like `nuxt-app-task:1`, `:2`, `:3`.

- `requiresCompatibilities: ["FARGATE"]` and `networkMode: "awsvpc"`  
  This tells AWS to run serverless containers on Fargate (no EC2 management by you).

- `cpu` and `memory`  
  The amount of compute reserved for one running task.

- `containerDefinitions[].name: "app"`  
  Logical container name. Must match `CONTAINER_NAME` in your workflow.

- `containerDefinitions[].image`  
  The exact ECR image to run (your built Nuxt Docker image).

- `portMappings.containerPort: 3000`  
  Your app listens on port `3000` inside container.

- `executionRoleArn`  
  Role ECS agent uses to pull image from ECR and push logs to CloudWatch.

- `taskRoleArn`  
  Role your app code uses at runtime (for example if app calls S3/SSM/etc).

- `logConfiguration`  
  Sends container logs to CloudWatch (`/ecs/nuxt-app-task`) so you can debug failures.

Simple flow:

1. GitHub pushes image to ECR.
2. ECS reads task definition.
3. ECS pulls that image and starts container with these settings.
4. ECS service keeps desired number of tasks running.

### `Dockerfile`

This Dockerfile uses a **multi-stage build**.  
That means we build the app in one temporary image (`builder`) and run it from a cleaner final image (`runner`).

Why this is good:

- final image is smaller
- fewer build tools in production image
- better security surface than shipping full source/build toolchain

Current Dockerfile:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

Line-by-line explanation:

1. `FROM node:20-alpine AS builder`  
   Starts the build stage using Node 20 on Alpine Linux. `AS builder` gives this stage a name.

2. `WORKDIR /app`  
   Sets `/app` as the working directory for all next commands.

3. `COPY package.json yarn.lock ./`  
   Copies only dependency manifest files first. This helps Docker cache dependency install layers.

4. `RUN corepack enable && yarn install --frozen-lockfile`  
   Enables Corepack and installs exact dependency versions from `yarn.lock`.  
   `--frozen-lockfile` avoids unexpected version drift in CI/CD.

5. `COPY . .`  
   Copies full project source into container after dependencies are installed.

6. `RUN yarn build`  
   Builds Nuxt for production. Output is generated in `.output`.

7. `FROM node:20-alpine AS runner`  
   Starts a fresh runtime stage. Build cache/files not explicitly copied are left behind.

8. `WORKDIR /app`  
   Sets runtime working directory.

9. `ENV NODE_ENV=production`  
   Enables production mode behavior (performance/security defaults in many libs).

10. `ENV HOST=0.0.0.0`  
    Ensures server binds to all interfaces so ECS networking can reach it.

11. `ENV PORT=3000`  
    Sets app listening port to `3000` (must match ECS task definition port mapping).

12. `COPY --from=builder /app/.output ./.output`  
    Copies only Nuxt build output from builder stage.

13. `COPY --from=builder /app/public ./public`  
    Copies static assets needed at runtime.

14. `EXPOSE 3000`  
    Documents runtime port. (Does not publish by itself; ECS/security group controls actual access.)

15. `CMD ["node", ".output/server/index.mjs"]`  
    Container startup command. Runs Nuxt Nitro server.

How this connects to ECS:

- GitHub Action builds this Docker image and pushes it to ECR.
- ECS task definition points to that image.
- ECS starts container with this `CMD` and environment.
- If `CMD` fails, service stays at `runningCount = 0`.

### `.dockerignore`

Excludes unneeded files from Docker build context (faster builds, smaller context).

### `package.json`

Added test command:

- `"test": "vitest run"`

### `app/tests/about-page.test.ts`

Simple starter test to ensure test pipeline works.

---

## 3) Region Change (Important)

You switched deployment from US to EU.

Current expected region:

- `eu-west-1`

This must match in **all** places:

- workflow `AWS_REGION`
- ECR repository region
- ECS cluster/service region
- task definition image URI region
- CloudWatch logs region

---

## 4) AWS Resources Required

Make sure these exist in `eu-west-1`:

1. ECR repository:
   - `nuxt-app`
   - What it is: a container image registry (storage) for Docker images.
   - Who uses it: GitHub Actions pushes images; ECS pulls images.
   - Why it exists: without ECR, ECS has no image to run.
   - Think of it like: "Docker image warehouse."
2. ECS cluster:
   - `nuxt-cluster`
   - What it is: a logical container runtime environment in ECS.
   - Who uses it: ECS service lives inside a cluster.
   - Why it exists: it is the container "home" where services/tasks run.
   - Think of it like: "deployment workspace."
3. ECS service:
   - currently: `nuxt-app-task-service-1uesxq5z`
   - What it is: a controller that keeps desired task count running.
   - Who uses it: deployment updates this service to new task definition revisions.
   - Why it exists: if a task dies, service starts a replacement automatically.
   - Think of it like: "always-keep-app-alive manager."
4. Task definition family:
   - `nuxt-app-task`
   - What it is: versioned blueprint for running one task.
   - Includes: image URI, cpu/memory, ports, environment, IAM roles, logs.
   - Why it exists: each deploy usually creates a new revision (`:1`, `:2`, `:3`).
   - Think of it like: "runtime recipe."
5. IAM roles:
   - `ecsTaskExecutionRole`
   - `ecsTaskRole`
   - What they are: permission identities used by ECS and your app.
   - Difference:
     - `ecsTaskExecutionRole`: platform-level permissions (pull ECR image, write CloudWatch logs).
     - `ecsTaskRole`: app-level permissions at runtime (S3, SSM, DynamoDB, SNS, etc.).
   - Why they exist: split security responsibilities and follow least privilege.
6. ECS service-linked role:
   - `AWSServiceRoleForECS`
   - What it is: AWS-managed role ECS itself assumes to manage resources in your account.
   - Who uses it: ECS control plane (not your container code).
   - Why it exists: required for ECS internal operations around services/deployments.
   - Think of it like: "ECS's own admin badge in your account."

Quick relationship map:

- GitHub Actions builds image -> pushes to ECR (`nuxt-app`)
- ECS service in cluster (`nuxt-cluster`) points to task definition family (`nuxt-app-task`)
- Task definition tells ECS which image/ports/roles to use
- ECS uses `ecsTaskExecutionRole` to start task plumbing
- Your app inside the task uses `ecsTaskRole` for AWS API calls
- ECS control plane uses `AWSServiceRoleForECS` to orchestrate service lifecycle

---

## 4.1) AWS Portal Steps (Exact Click Path)

Use these steps in AWS Console (top-right region must be `eu-west-1`).

### A) Create ECR Repository (`nuxt-app`)

1. Open **Amazon ECR**.
2. Left menu -> **Repositories**.
3. Click **Create repository**.
4. Repository name -> `nuxt-app`.
5. Keep defaults, click **Create repository**.

### B) Create ECS Cluster (`nuxt-cluster`)

1. Open **Amazon ECS**.
2. Left menu -> **Clusters**.
3. Click **Create cluster**.
4. Cluster name -> `nuxt-cluster`.
5. Infrastructure -> **AWS Fargate (serverless)**.
6. Click **Create**.

### C) Create IAM Role: `ecsTaskExecutionRole` (required)

1. Open **IAM**.
2. Left menu -> **Roles** -> **Create role**.
3. Trusted entity type -> **AWS service**.
4. Service or use case -> **Elastic Container Service** -> **Elastic Container Service Task**.
5. Click **Next**.
6. Attach policy -> `AmazonECSTaskExecutionRolePolicy`.
7. Role name -> `ecsTaskExecutionRole`.
8. Click **Create role**.

### D) Create IAM Role: `ecsTaskRole` (runtime role)

1. **IAM** -> **Roles** -> **Create role**.
2. Trusted entity type -> **AWS service**.
3. Use case -> **Elastic Container Service Task**.
4. Click **Next** (attach app-specific policies later if needed).
5. Role name -> `ecsTaskRole`.
6. Click **Create role**.

Trust relationship for both roles should be:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### E) Register Task Definition (`nuxt-app-task`)

1. Open **Amazon ECS**.
2. Left menu -> **Task definitions**.
3. Click **Create new task definition**.
4. Launch type compatibility -> **Fargate**.
5. Family -> `nuxt-app-task`.
6. Execution role -> `ecsTaskExecutionRole`.
7. Task role -> `ecsTaskRole`.
8. Add container:
   - Name -> `app`
   - Image URI -> `878752032363.dkr.ecr.eu-west-1.amazonaws.com/nuxt-app:latest`
   - Port mapping -> `3000`
   - Logs -> CloudWatch log group `/ecs/nuxt-app-task`
9. Save task definition.

### F) Create ECS Service

1. **Amazon ECS** -> **Clusters** -> open `nuxt-cluster`.
2. Click **Create service**.
3. Launch type -> **Fargate**.
4. Task definition family -> `nuxt-app-task` (latest revision).
5. Service name -> (your current one is auto-generated; stable name recommended: `nuxt-service`).
6. Desired tasks -> `1`.
7. Networking:
   - Select VPC and subnets
   - Select security group (allow app traffic on port `3000` or via ALB)
8. Create service.

### G) Add GitHub Secrets

1. Open GitHub repo -> **Settings**.
2. **Secrets and variables** -> **Actions**.
3. Add repository secrets:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
4. If using environment protection (`production`), also add same secrets there:
   - **Settings** -> **Environments** -> `production` -> **Environment secrets**.

### H) Trigger Deployment

1. Push commit to `main`.
2. Open **GitHub Actions** and watch jobs:
   - Build
   - Test
   - Deploy
3. In AWS ECS service page, confirm:
   - desired = 1
   - running = 1
   - latest deployment status becomes stable.

---

## 5) GitHub Secrets Required

In GitHub repo settings (Actions secrets), add:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

If using environment protection (`environment: production`), make sure secrets are also available in that environment.

---

## 6) Common Errors We Hit + Meaning

### `Could not load credentials from any providers`

GitHub secrets missing/wrong name.

### `ecr:GetAuthorizationToken not authorized`

IAM user missing ECR permissions.

### `Dockerfile: no such file or directory`

No `Dockerfile` existed in repo root (fixed).

### `name unknown: repository ... does not exist`

ECR repo not created in that region.

### `Role is not valid`

Task definition role ARNs were placeholders or invalid.

### `Cluster not found`

Wrong cluster name/region mismatch.

### `Unable to assume the service linked role`

ECS service-linked role issue (`AWSServiceRoleForECS`) or IAM account setup issue.

### `MISSING` from `aws ecs wait services-stable`

Service name passed to command was wrong (placeholder used instead of real service name).

---

## 7) How to Check Health Quickly

### Service summary

```bash
aws ecs describe-services \
  --cluster nuxt-cluster \
  --services nuxt-app-task-service-1uesxq5z \
  --region eu-west-1 \
  --query 'services[0].{status:status,desired:desiredCount,running:runningCount,pending:pendingCount,rollout:deployments[0].rolloutState,taskDef:taskDefinition}' \
  --output table
```

### Recent ECS service events

```bash
aws ecs describe-services \
  --cluster nuxt-cluster \
  --services nuxt-app-task-service-1uesxq5z \
  --region eu-west-1 \
  --query 'services[0].events[0:10].[createdAt,message]' \
  --output table
```

### Wait for stable

```bash
aws ecs wait services-stable \
  --cluster nuxt-cluster \
  --services nuxt-app-task-service-1uesxq5z \
  --region eu-west-1
```

---

## 8) Current Status Snapshot

At latest check:

- Service exists and is `ACTIVE`
- Desired count = `1`
- Running count was `0` at one point

If `runningCount` stays `0`, check:

1. ECS service events
2. CloudWatch logs for `/ecs/nuxt-app-task`
3. Security group/networking (port `3000` / ALB routing)
4. Task execution role permissions

---

## 9) Recommended Next Improvements

1. Rename service to stable name (optional), e.g. `nuxt-service`
2. Move from IAM user keys to GitHub OIDC role (more secure)
3. Replace broad IAM permissions with least-privilege policy
4. Add health checks/load balancer for production traffic
5. Add rollback strategy in workflow (optional)

---

## 10) Quick Mental Model

Think of deployment like this:

- **GitHub Actions** is the automation engine
- **Dockerfile** packages your app
- **ECR** stores that package (image)
- **ECS Task Definition** says how to run it
- **ECS Service** keeps it running
- **IAM** allows each piece to talk to each other

If one fails, deployment fails. The logs/events tell you which layer is broken.

