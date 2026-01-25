#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { CliCredentialsStackSynthesizer } from "aws-cdk-lib";
import { ArgusVectorStack, PipelineStack } from "../lib/stacks";
import {
  getEnvironmentConfig,
  getDevEnvironmentConfig,
  PIPELINE_STAGES,
} from "../lib/config";
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
// 1. Copy this block and change DEV_STAGE to your initials (e.g., "dev-ab")
// 2. Run: cdk bootstrap (once per region if not already done)
// 3. Run: cdk deploy ms-argus-vector-dev-{initials}
// =============================================================================

const DEV_STAGE = "dev-jw";

new ArgusVectorStack(app, `${PROJECT_NAME}-${DEV_STAGE}`, {
  config: {
    ...getDevEnvironmentConfig(DEV_STAGE, AWS_ACCOUNT_ID, AWS_REGION),
    name: "qa", // Type constraint - uses QA-like settings
    stageName: DEV_STAGE, // Use actual stage name for SSM params and exports
  },
  env: { account: AWS_ACCOUNT_ID, region: AWS_REGION },
  stackName: `${PROJECT_NAME}-${DEV_STAGE}`,
  synthesizer: new CliCredentialsStackSynthesizer(),
  tags: {
    Environment: DEV_STAGE,
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
  const config = getEnvironmentConfig(stage.envName, AWS_ACCOUNT_ID, AWS_REGION);

  new ArgusVectorStack(app, `ArgusVector-${stage.name}`, {
    config,
    env: config.env,
    stackName: `${PROJECT_NAME}-${stage.envName}`,
    tags: {
      Environment: stage.envName,
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
