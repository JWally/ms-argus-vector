import type { Environment } from "aws-cdk-lib";

export type EnvironmentName = "qa" | "uat" | "prod";

export interface QdrantConfig {
  /**
   * Number of QDrant nodes to deploy
   */
  nodeCount: number;

  /**
   * Fargate CPU units (256, 512, 1024, 2048, 4096)
   */
  cpu: number;

  /**
   * Fargate memory in MB
   */
  memoryMiB: number;

  /**
   * QDrant container image tag
   */
  imageTag: string;

  /**
   * Enable QDrant API key authentication
   */
  enableApiKey: boolean;
}

export interface EnvironmentConfig {
  /**
   * Environment name (for resource sizing/settings: qa, uat, prod)
   */
  name: EnvironmentName;

  /**
   * Stage name for SSM parameters and cross-stack references
   * Defaults to `name` but can be overridden for dev stacks (e.g., dev-jw)
   */
  stageName?: string;

  /**
   * AWS account and region
   */
  env: Environment;

  /**
   * QDrant configuration
   */
  qdrant: QdrantConfig;

  /**
   * VPC configuration
   */
  vpc: {
    maxAzs: number;
    natGateways: number;
  };

  /**
   * EFS configuration
   */
  efs: {
    /**
     * Enable automatic backups
     */
    enableBackups: boolean;

    /**
     * Lifecycle policy - move to IA after N days (0 to disable)
     */
    lifecycleInfrequentAccessDays: number;
  };
}

/**
 * Get environment configuration by name
 */
export function getEnvironmentConfig(
  envName: EnvironmentName,
  account: string,
  region: string = "us-east-1"
): EnvironmentConfig {
  const baseConfig = {
    env: { account, region },
  };

  switch (envName) {
    case "qa":
      return {
        ...baseConfig,
        name: "qa",
        qdrant: {
          nodeCount: 1,
          cpu: 512,
          memoryMiB: 1024,
          imageTag: "latest",
          enableApiKey: true,
        },
        vpc: {
          maxAzs: 2,
          natGateways: 1,
        },
        efs: {
          enableBackups: false,
          lifecycleInfrequentAccessDays: 7,
        },
      };

    case "uat":
      return {
        ...baseConfig,
        name: "uat",
        qdrant: {
          nodeCount: 1,
          cpu: 1024,
          memoryMiB: 2048,
          imageTag: "latest",
          enableApiKey: true,
        },
        vpc: {
          maxAzs: 2,
          natGateways: 1,
        },
        efs: {
          enableBackups: true,
          lifecycleInfrequentAccessDays: 14,
        },
      };

    case "prod":
      return {
        ...baseConfig,
        name: "prod",
        qdrant: {
          nodeCount: 3,
          cpu: 2048,
          memoryMiB: 4096,
          imageTag: "v1.12.6", // Pin to stable version in prod
          enableApiKey: true,
        },
        vpc: {
          maxAzs: 3,
          natGateways: 3,
        },
        efs: {
          enableBackups: true,
          lifecycleInfrequentAccessDays: 30,
        },
      };

    default:
      throw new Error(`Unknown environment: ${envName}`);
  }
}

/**
 * Personal dev environment configuration
 * Used for individual developer stacks (e.g., dev-jw)
 */
export function getDevEnvironmentConfig(
  stageName: string,
  account: string,
  region: string = "us-east-1"
): EnvironmentConfig {
  return {
    name: "qa", // Use QA-like settings for dev
    env: { account, region },
    qdrant: {
      nodeCount: 1,
      cpu: 512,
      memoryMiB: 1024,
      imageTag: "latest",
      enableApiKey: true,
    },
    vpc: {
      maxAzs: 2,
      natGateways: 1,
    },
    efs: {
      enableBackups: false,
      lifecycleInfrequentAccessDays: 7,
    },
  };
}

/**
 * Resource naming helper
 */
export function resourceName(
  envName: string,
  resource: string
): string {
  return `argus-vector-${envName}-${resource}`;
}

/**
 * Pipeline stages in deployment order
 */
export const PIPELINE_STAGES: { name: string; envName: EnvironmentName }[] = [
  { name: "QA", envName: "qa" },
  { name: "Uat", envName: "uat" },
  { name: "Prod", envName: "prod" },
];
