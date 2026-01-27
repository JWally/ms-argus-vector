import type { Environment } from "aws-cdk-lib";

/**
 * Stage name for config lookup (sizing, thresholds, etc.)
 */
export type StageName = "qa" | "uat" | "prod";

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
   * Environment name for resource naming (e.g., "dev-jw", "qa", "prod")
   * All AWS resources will be named with this value.
   */
  environment: string;

  /**
   * Stage for config lookup (sizing, retention policies, etc.)
   * Maps to predefined configurations: "qa", "uat", "prod"
   */
  stage: StageName;

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
 * Stage-specific configuration (sizing, retention, etc.)
 */
interface StageConfig {
  qdrant: QdrantConfig;
  vpc: { maxAzs: number; natGateways: number };
  efs: { enableBackups: boolean; lifecycleInfrequentAccessDays: number };
}

const STAGE_CONFIGS: Record<StageName, StageConfig> = {
  qa: {
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
  },
  uat: {
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
  },
  prod: {
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
  },
};

/**
 * Get environment configuration
 *
 * @param environment - Environment name for resource naming (e.g., "dev-jw", "qa", "prod")
 * @param stage - Stage for config lookup ("qa", "uat", "prod")
 * @param account - AWS account ID
 * @param region - AWS region
 */
export function getEnvironmentConfig(
  environment: string,
  stage: StageName,
  account: string,
  region: string = "us-east-1"
): EnvironmentConfig {
  const stageConfig = STAGE_CONFIGS[stage];

  return {
    environment,
    stage,
    env: { account, region },
    ...stageConfig,
  };
}

/**
 * Resource naming helper
 */
export function resourceName(environment: string, resource: string): string {
  return `argus-vector-${environment}-${resource}`;
}

/**
 * Pipeline stages in deployment order
 */
export const PIPELINE_STAGES: { name: string; environment: string; stage: StageName }[] = [
  { name: "QA", environment: "qa", stage: "qa" },
  { name: "Uat", environment: "uat", stage: "uat" },
  { name: "Prod", environment: "prod", stage: "prod" },
];
