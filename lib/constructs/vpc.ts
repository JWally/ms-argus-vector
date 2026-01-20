import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib";
import type { EnvironmentConfig } from "../config";

export interface ArgusVpcProps {
  config: EnvironmentConfig;
}

/**
 * VPC construct for Argus Vector infrastructure.
 * Creates a VPC with public and private subnets across multiple AZs.
 */
export class ArgusVpc extends Construct {
  public readonly vpc: ec2.IVpc;
  public readonly ecsSecurityGroup: ec2.ISecurityGroup;
  public readonly efsSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: ArgusVpcProps) {
    super(scope, id);

    const { config } = props;

    // Create VPC with private subnets for ECS tasks
    this.vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `argus-vector-${config.name}-vpc`,
      maxAzs: config.vpc.maxAzs,
      natGateways: config.vpc.natGateways,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    // Security group for EFS
    this.efsSecurityGroup = new ec2.SecurityGroup(this, "EfsSecurityGroup", {
      vpc: this.vpc,
      securityGroupName: `argus-vector-${config.name}-efs-sg`,
      description: "Security group for EFS mount targets",
      allowAllOutbound: false,
    });

    // Security group for ECS tasks
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc: this.vpc,
      securityGroupName: `argus-vector-${config.name}-ecs-sg`,
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

    // Tags
    cdk.Tags.of(this).add("Environment", config.name);
    cdk.Tags.of(this).add("Service", "argus-vector");
  }
}
