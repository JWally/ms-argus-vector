import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as cdk from "aws-cdk-lib";
import type { EnvironmentConfig } from "../config";

export interface ArgusVpcProps {
  config: EnvironmentConfig;
}

/**
 * VPC construct for Argus Vector infrastructure.
 *
 * Imports the shared VPC from ms-argus-infra via SSM Parameter Store.
 * Creates service-specific security groups for ECS and EFS.
 *
 * Required SSM parameters (created by ms-argus-infra):
 *   /argus/{environment}/vpc-id
 */
export class ArgusVpc extends Construct {
  public readonly vpc: ec2.IVpc;
  public readonly ecsSecurityGroup: ec2.ISecurityGroup;
  public readonly efsSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: ArgusVpcProps) {
    super(scope, id);

    const { config } = props;
    const { environment } = config;

    // =========================================================================
    // IMPORT SHARED VPC FROM MS-ARGUS-INFRA
    // =========================================================================

    const ssmPrefix = `/argus/${environment}`;

    // Use valueFromLookup for synth-time resolution (required for VPC lookup)
    const vpcId = ssm.StringParameter.valueFromLookup(
      this,
      `${ssmPrefix}/vpc-id`
    );

    // Import VPC - this requires the VPC to already exist
    this.vpc = ec2.Vpc.fromLookup(this, "SharedVpc", {
      vpcId,
    });

    // =========================================================================
    // SECURITY GROUPS (service-specific, created here)
    // =========================================================================

    // Security group for EFS
    this.efsSecurityGroup = new ec2.SecurityGroup(this, "EfsSecurityGroup", {
      vpc: this.vpc,
      securityGroupName: `argus-vector-${environment}-efs-sg`,
      description: "Security group for EFS mount targets",
      allowAllOutbound: false,
    });

    // Security group for ECS tasks
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc: this.vpc,
      securityGroupName: `argus-vector-${environment}-ecs-sg`,
      description: "Security group for QDrant ECS tasks",
      allowAllOutbound: true,
    });

    // Allow ECS to access EFS
    this.efsSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(2049),
      "Allow NFS from ECS tasks"
    );

    // QDrant API ports - allow from within VPC
    this.ecsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(6333),
      "QDrant REST API"
    );

    this.ecsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(6334),
      "QDrant gRPC API"
    );

    // For cluster mode: internal P2P communication between nodes
    if (config.qdrant.nodeCount > 1) {
      this.ecsSecurityGroup.addIngressRule(
        this.ecsSecurityGroup,
        ec2.Port.tcp(6335),
        "QDrant internal P2P"
      );
    }

    // =========================================================================
    // TAGS
    // =========================================================================

    cdk.Tags.of(this).add("Environment", environment);
    cdk.Tags.of(this).add("Service", "argus-vector");
  }
}
