import * as cdk from "aws-cdk-lib";
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

    // Stack outputs
    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.qdrantService.cluster.clusterArn,
      description: "ECS Cluster ARN",
      exportName: `argus-vector-${config.name}-cluster-arn`,
    });

    new cdk.CfnOutput(this, "ServiceArn", {
      value: this.qdrantService.service.serviceArn,
      description: "ECS Service ARN",
      exportName: `argus-vector-${config.name}-service-arn`,
    });

    new cdk.CfnOutput(this, "LoadBalancerDns", {
      value: this.qdrantService.loadBalancer.loadBalancerDnsName,
      description: "ALB DNS name for QDrant access",
      exportName: `argus-vector-${config.name}-alb-dns`,
    });

    new cdk.CfnOutput(this, "QdrantRestEndpoint", {
      value: `http://${this.qdrantService.loadBalancer.loadBalancerDnsName}:6333`,
      description: "QDrant REST API endpoint",
      exportName: `argus-vector-${config.name}-rest-endpoint`,
    });

    new cdk.CfnOutput(this, "ApiSecretArn", {
      value: this.qdrantService.apiSecret.secretArn,
      description: "QDrant API key secret ARN",
      exportName: `argus-vector-${config.name}-api-secret-arn`,
    });

    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpc.vpcId,
      description: "VPC ID",
      exportName: `argus-vector-${config.name}-vpc-id`,
    });

    new cdk.CfnOutput(this, "FileSystemId", {
      value: this.storage.fileSystem.fileSystemId,
      description: "EFS File System ID",
      exportName: `argus-vector-${config.name}-efs-id`,
    });
  }
}
