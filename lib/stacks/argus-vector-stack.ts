import * as cdk from "aws-cdk-lib";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import type { EnvironmentConfig } from "../config";
import { ArgusVpc, ArgusStorage, QdrantService } from "../constructs";

export interface ArgusVectorStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/**
 * Main infrastructure stack for Argus Vector (QDrant).
 *
 * Imports shared VPC from ms-argus-infra and deploys:
 * - EFS storage for Qdrant persistence
 * - QDrant ECS service with ALB
 *
 * Requires ms-argus-infra to be deployed first.
 */
export class ArgusVectorStack extends cdk.Stack {
  public readonly vpc: ArgusVpc;
  public readonly storage: ArgusStorage;
  public readonly qdrantService: QdrantService;

  constructor(scope: Construct, id: string, props: ArgusVectorStackProps) {
    super(scope, id, {
      ...props,
      env: props.config.env,
      description: `Argus Vector (QDrant) infrastructure for ${props.config.environment}`,
    });

    const { config } = props;
    const { environment } = config;

    // Import shared VPC from ms-argus-infra and create service-specific security groups
    this.vpc = new ArgusVpc(this, "Vpc", { config });

    // Create EFS storage
    this.storage = new ArgusStorage(this, "Storage", {
      config,
      vpc: this.vpc.vpc,
      securityGroup: this.vpc.efsSecurityGroup,
    });

    // Create QDrant service
    this.qdrantService = new QdrantService(this, "QdrantService", {
      config,
      vpc: this.vpc.vpc,
      securityGroup: this.vpc.ecsSecurityGroup,
      fileSystem: this.storage.fileSystem,
      accessPoint: this.storage.accessPoint,
    });

    // =========================================================================
    // STACK OUTPUTS
    // =========================================================================

    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.qdrantService.cluster.clusterArn,
      description: "ECS Cluster ARN",
      exportName: `argus-vector-${environment}-cluster-arn`,
    });

    new cdk.CfnOutput(this, "ServiceArn", {
      value: this.qdrantService.service.serviceArn,
      description: "ECS Service ARN",
      exportName: `argus-vector-${environment}-service-arn`,
    });

    new cdk.CfnOutput(this, "LoadBalancerDns", {
      value: this.qdrantService.loadBalancer.loadBalancerDnsName,
      description: "ALB DNS name for QDrant access",
      exportName: `argus-vector-${environment}-alb-dns`,
    });

    new cdk.CfnOutput(this, "QdrantRestEndpoint", {
      value: `http://${this.qdrantService.loadBalancer.loadBalancerDnsName}:6333`,
      description: "QDrant REST API endpoint",
      exportName: `argus-vector-${environment}-rest-endpoint`,
    });

    new cdk.CfnOutput(this, "ApiSecretArn", {
      value: this.qdrantService.apiSecret.secretArn,
      description: "QDrant API key secret ARN",
      exportName: `argus-vector-${environment}-api-secret-arn`,
    });

    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpc.vpcId,
      description: "VPC ID (shared from ms-argus-infra)",
      exportName: `argus-vector-${environment}-vpc-id`,
    });

    new cdk.CfnOutput(this, "FileSystemId", {
      value: this.storage.fileSystem.fileSystemId,
      description: "EFS File System ID",
      exportName: `argus-vector-${environment}-efs-id`,
    });

    // =========================================================================
    // SSM PARAMETERS
    // Store Qdrant connection info in Parameter Store for cross-stack sharing
    // Other stacks (ms-argus-api) can read these at deploy or runtime
    // =========================================================================

    new ssm.StringParameter(this, "QdrantUrlParam", {
      parameterName: `/argus-vector/${environment}/qdrant-url`,
      stringValue: `http://${this.qdrantService.loadBalancer.loadBalancerDnsName}:6333`,
      description: `QDrant REST API endpoint for ${environment} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "QdrantSecretArnParam", {
      parameterName: `/argus-vector/${environment}/qdrant-secret-arn`,
      stringValue: this.qdrantService.apiSecret.secretArn,
      description: `QDrant API key secret ARN for ${environment} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    // Re-export VPC ID for consumers (e.g., ms-argus-api) that reference argus-vector
    // This points to the shared VPC from ms-argus-infra
    new ssm.StringParameter(this, "VpcIdParam", {
      parameterName: `/argus-vector/${environment}/vpc-id`,
      stringValue: this.vpc.vpc.vpcId,
      description: `VPC ID for ${environment} environment (shared from ms-argus-infra)`,
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
