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
 * Composes VPC, EFS storage, and QDrant ECS service.
 */
export class ArgusVectorStack extends cdk.Stack {
  public readonly vpc: ArgusVpc;
  public readonly storage: ArgusStorage;
  public readonly qdrantService: QdrantService;

  constructor(scope: Construct, id: string, props: ArgusVectorStackProps) {
    super(scope, id, {
      ...props,
      env: props.config.env,
      description: `Argus Vector (QDrant) infrastructure for ${props.config.name}`,
    });

    const { config } = props;

    // Use stageName for cross-stack references, fallback to name
    const stageName = config.stageName ?? config.name;

    // Create VPC
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

    // Stack outputs - use stageName for cross-stack references
    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.qdrantService.cluster.clusterArn,
      description: "ECS Cluster ARN",
      exportName: `argus-vector-${stageName}-cluster-arn`,
    });

    new cdk.CfnOutput(this, "ServiceArn", {
      value: this.qdrantService.service.serviceArn,
      description: "ECS Service ARN",
      exportName: `argus-vector-${stageName}-service-arn`,
    });

    new cdk.CfnOutput(this, "LoadBalancerDns", {
      value: this.qdrantService.loadBalancer.loadBalancerDnsName,
      description: "ALB DNS name for QDrant access",
      exportName: `argus-vector-${stageName}-alb-dns`,
    });

    new cdk.CfnOutput(this, "QdrantRestEndpoint", {
      value: `http://${this.qdrantService.loadBalancer.loadBalancerDnsName}:6333`,
      description: "QDrant REST API endpoint",
      exportName: `argus-vector-${stageName}-rest-endpoint`,
    });

    new cdk.CfnOutput(this, "ApiSecretArn", {
      value: this.qdrantService.apiSecret.secretArn,
      description: "QDrant API key secret ARN",
      exportName: `argus-vector-${stageName}-api-secret-arn`,
    });

    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpc.vpcId,
      description: "VPC ID",
      exportName: `argus-vector-${stageName}-vpc-id`,
    });

    new cdk.CfnOutput(this, "FileSystemId", {
      value: this.storage.fileSystem.fileSystemId,
      description: "EFS File System ID",
      exportName: `argus-vector-${stageName}-efs-id`,
    });

    // Legacy exports for backwards compatibility during migration
    // These can be removed once all consumers use SSM parameters
    if (stageName !== config.name) {
      new cdk.CfnOutput(this, "LegacyApiSecretArn", {
        value: this.qdrantService.apiSecret.secretArn,
        description: "(Legacy) QDrant API key secret ARN",
        exportName: `argus-vector-${config.name}-api-secret-arn`,
      });

      new cdk.CfnOutput(this, "LegacyRestEndpoint", {
        value: `http://${this.qdrantService.loadBalancer.loadBalancerDnsName}:6333`,
        description: "(Legacy) QDrant REST API endpoint",
        exportName: `argus-vector-${config.name}-rest-endpoint`,
      });

      new cdk.CfnOutput(this, "LegacyVpcId", {
        value: this.vpc.vpc.vpcId,
        description: "(Legacy) VPC ID",
        exportName: `argus-vector-${config.name}-vpc-id`,
      });
    }

    // =========================================================================
    // SSM PARAMETERS
    // Store Qdrant connection info in Parameter Store for cross-stack sharing
    // Other stacks (ms-argus-api) can read these at deploy or runtime
    // =========================================================================

    new ssm.StringParameter(this, "QdrantUrlParam", {
      parameterName: `/argus-vector/${stageName}/qdrant-url`,
      stringValue: `http://${this.qdrantService.loadBalancer.loadBalancerDnsName}:6333`,
      description: `QDrant REST API endpoint for ${stageName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "QdrantSecretArnParam", {
      parameterName: `/argus-vector/${stageName}/qdrant-secret-arn`,
      stringValue: this.qdrantService.apiSecret.secretArn,
      description: `QDrant API key secret ARN for ${stageName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });

    new ssm.StringParameter(this, "VpcIdParam", {
      parameterName: `/argus-vector/${stageName}/vpc-id`,
      stringValue: this.vpc.vpc.vpcId,
      description: `VPC ID for ${stageName} environment`,
      tier: ssm.ParameterTier.STANDARD,
    });
  }
}
