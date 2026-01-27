#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CliCredentialsStackSynthesizer } from "aws-cdk-lib";
import { ArgusVectorStack, PipelineStack } from "../lib/stacks";
import { getEnvironmentConfig, PIPELINE_STAGES } from "../lib/config";
import {
  AWS_ACCOUNT_ID,
  AWS_REGION,
  PROJECT_NAME,
  CODESTAR_CONNECTION_ARN,
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
} from "./config";

const app = new cdk.App();

if (!AWS_ACCOUNT_ID) {
  console.error(
    "Error: AWS account not specified. Set CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variable."
  );
  process.exit(1);
}

// =============================================================================
// Personal Dev Stack (ms-argus-vector-dev-jw)
// -----------------------------------------------------------------------------
// To add your own dev stack:
// 1. Copy this block and change DEV_ENVIRONMENT to your initials (e.g., "dev-ab")
// 2. Run: cdk bootstrap (once per region if not already done)
// 3. Run: cdk deploy ms-argus-vector-dev-{initials}
// =============================================================================

const DEV_ENVIRONMENT = "dev-jw";

new ArgusVectorStack(app, `${PROJECT_NAME}-${DEV_ENVIRONMENT}`, {
  config: getEnvironmentConfig(DEV_ENVIRONMENT, "qa", AWS_ACCOUNT_ID, AWS_REGION),
  env: { account: AWS_ACCOUNT_ID, region: AWS_REGION },
  stackName: `${PROJECT_NAME}-${DEV_ENVIRONMENT}`,
  synthesizer: new CliCredentialsStackSynthesizer(),
  tags: {
    Environment: DEV_ENVIRONMENT,
    Project: PROJECT_NAME,
    Owner: "jw",
    ManagedBy: "cdk",
  },
});

// =============================================================================
// Pipeline Stacks (QA, Uat, Prod)
// -----------------------------------------------------------------------------
// These stacks are deployed via CodePipeline, not directly.
// Deploy the pipeline with: cdk deploy ArgusVector-Pipeline
// =============================================================================

// Create stacks for each pipeline stage (for CDK synth)
for (const stage of PIPELINE_STAGES) {
  const config = getEnvironmentConfig(
    stage.environment,
    stage.stage,
    AWS_ACCOUNT_ID,
    AWS_REGION
  );

  new ArgusVectorStack(app, `ArgusVector-${stage.name}`, {
    config,
    env: config.env,
    stackName: `${PROJECT_NAME}-${stage.environment}`,
    tags: {
      Environment: stage.environment,
      Project: PROJECT_NAME,
      ManagedBy: "cdk-pipeline",
    },
  });
}

// =============================================================================
// CI/CD Pipeline Stack
// -----------------------------------------------------------------------------
// Deploy with: cdk deploy ArgusVector-Pipeline
// Requires CODESTAR_CONNECTION_ARN environment variable for GitHub
// =============================================================================

const deployPipeline = app.node.tryGetContext("pipeline") === "true";

if (deployPipeline || CODESTAR_CONNECTION_ARN) {
  new PipelineStack(app, "ArgusVector-Pipeline", {
    account: AWS_ACCOUNT_ID,
    region: AWS_REGION,
    env: { account: AWS_ACCOUNT_ID, region: AWS_REGION },
    github: CODESTAR_CONNECTION_ARN
      ? {
          owner: GITHUB_OWNER,
          repo: GITHUB_REPO,
          branch: GITHUB_BRANCH,
          connectionArn: CODESTAR_CONNECTION_ARN,
        }
      : undefined,
    tags: {
      Project: PROJECT_NAME,
      ManagedBy: "cdk",
    },
  });
}

app.synth();
