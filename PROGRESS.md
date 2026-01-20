# ms-argus-vector Build Progress

## Project Overview
CDK infrastructure for QDrant vector database on AWS ECS Fargate.

## Architecture Decisions
- **Deployment**: ECS Fargate (serverless containers)
- **Topology**: Single node for qa/uat, 3-node cluster for prod
- **Storage**: EFS (required for Fargate persistence)
- **CI/CD**: AWS CodePipeline with manual approval gates
- **Environments**: qa, uat, prod (+ personal dev stacks like dev-jw)

## Completed

### Configuration
- `bin/config.ts` - AWS account/region from env vars (CDK_DEFAULT_ACCOUNT, AWS_ACCOUNT_ID)
- `lib/config/environments.ts` - Environment configs for qa, uat, prod
  - **qa**: 1 node, 512 CPU, 1GB RAM, no backups
  - **uat**: 1 node, 1024 CPU, 2GB RAM, with backups
  - **prod**: 3 nodes, 2048 CPU, 4GB RAM, pinned version v1.12.6, full backups

### Constructs
- `lib/constructs/vpc.ts` - VPC with public/private subnets, security groups
- `lib/constructs/storage.ts` - Encrypted EFS with access points
- `lib/constructs/qdrant-service.ts` - ECS Fargate service with:
  - API key via Secrets Manager
  - Cloud Map service discovery (cluster mode)
  - Internal ALB with REST API (port 6333)
  - EFS mount for data persistence

### Stacks
- `lib/stacks/argus-vector-stack.ts` - Main infra stack
- `lib/stacks/pipeline-stack.ts` - CI/CD pipeline (QA → Uat → Prod)

### Entry Point
- `bin/ms-argus-vector.ts` - CDK app with:
  - Personal dev stack pattern (`ms-argus-vector-dev-jw`)
  - Pipeline stacks (QA, Uat, Prod)
  - Uses CliCredentialsStackSynthesizer for dev stacks

### Tests
- `tests/config.test.ts` - Environment config tests
- `tests/stacks.test.ts` - Stack synthesis tests

## Usage

### Personal dev stack:
```bash
cdk deploy ms-argus-vector-dev-jw
```

### Pipeline stacks (via CodePipeline):
```bash
cdk deploy ArgusVector-Pipeline -c pipeline=true
```

### All stacks:
```bash
cdk deploy --all
```

## File Structure
```
ms-argus-vector/
├── bin/
│   ├── config.ts               # AWS config from env vars
│   └── ms-argus-vector.ts      # CDK entry point
├── lib/
│   ├── config/
│   │   ├── environments.ts     # qa/uat/prod configs
│   │   └── index.ts
│   ├── constructs/
│   │   ├── vpc.ts              # VPC construct
│   │   ├── storage.ts          # EFS construct
│   │   ├── qdrant-service.ts   # ECS Fargate construct
│   │   └── index.ts
│   └── stacks/
│       ├── argus-vector-stack.ts  # Main stack
│       ├── pipeline-stack.ts      # CI/CD
│       └── index.ts
├── tests/
│   ├── config.test.ts
│   └── stacks.test.ts
├── cdk.json
├── package.json
├── tsconfig.json
├── eslint.config.mjs
└── PROGRESS.md
```

## Notes
- QDrant ports: 6333 (REST API), 6334 (gRPC - direct access only), 6335 (P2P)
- gRPC requires HTTPS on ALB, so only REST is exposed via ALB
- Container runs as UID/GID 1000 (qdrant user)
- ALB is internal-only; access via VPC
