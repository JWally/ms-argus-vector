import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as efs from "aws-cdk-lib/aws-efs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import * as cdk from "aws-cdk-lib";
import type { EnvironmentConfig } from "../config";

export interface QdrantServiceProps {
  config: EnvironmentConfig;
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
  fileSystem: efs.IFileSystem;
  accessPoint: efs.IAccessPoint;
}

/**
 * QDrant ECS Fargate service construct.
 * Deploys QDrant as a containerized service with EFS persistence.
 */
export class QdrantService extends Construct {
  public readonly cluster: ecs.ICluster;
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly apiSecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props: QdrantServiceProps) {
    super(scope, id);

    const { config, vpc, securityGroup, fileSystem, accessPoint } = props;
    const { environment, stage } = config;

    // Create API key secret
    this.apiSecret = new secretsmanager.Secret(this, "ApiSecret", {
      secretName: `argus-vector/${environment}/qdrant-api-key`,
      description: `QDrant API key for ${environment} environment`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // Create ECS cluster
    this.cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: `argus-vector-${environment}`,
      vpc,
      containerInsightsV2: stage === "prod"
        ? ecs.ContainerInsights.ENABLED
        : ecs.ContainerInsights.DISABLED,
    });

    // Create Cloud Map namespace for service discovery (cluster mode)
    let namespace: servicediscovery.IPrivateDnsNamespace | undefined;
    if (config.qdrant.nodeCount > 1) {
      namespace = new servicediscovery.PrivateDnsNamespace(this, "Namespace", {
        name: `qdrant.${environment}.local`,
        vpc,
        description: `QDrant service discovery for ${environment}`,
      });
    }

    // Create log group
    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/ecs/argus-vector-${environment}/qdrant`,
      retention:
        stage === "prod"
          ? logs.RetentionDays.THREE_MONTHS
          : logs.RetentionDays.ONE_WEEK,
      removalPolicy:
        stage === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // Create task definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TaskDefinition",
      {
        family: `argus-vector-${environment}-qdrant`,
        cpu: config.qdrant.cpu,
        memoryLimitMiB: config.qdrant.memoryMiB,
      }
    );

    // Add EFS volume
    taskDefinition.addVolume({
      name: "qdrant-storage",
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: "ENABLED",
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: "ENABLED",
        },
      },
    });

    // Grant task role access to EFS
    fileSystem.grantRootAccess(taskDefinition.taskRole);

    // Build environment variables
    const environment_vars: Record<string, string> = {
      QDRANT__SERVICE__HTTP_PORT: "6333",
      QDRANT__SERVICE__GRPC_PORT: "6334",
      QDRANT__STORAGE__STORAGE_PATH: "/qdrant/storage",
    };

    // Cluster mode configuration
    if (config.qdrant.nodeCount > 1 && namespace) {
      environment_vars.QDRANT__CLUSTER__ENABLED = "true";
      environment_vars.QDRANT__CLUSTER__P2P__PORT = "6335";
    }

    // Build secrets
    const secrets: Record<string, ecs.Secret> = {};
    if (config.qdrant.enableApiKey) {
      secrets.QDRANT__SERVICE__API_KEY = ecs.Secret.fromSecretsManager(
        this.apiSecret
      );
    }

    // Add QDrant container
    const container = taskDefinition.addContainer("qdrant", {
      containerName: "qdrant",
      image: ecs.ContainerImage.fromRegistry(
        `qdrant/qdrant:${config.qdrant.imageTag}`
      ),
      environment: environment_vars,
      secrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "qdrant",
        logGroup,
      }),
      // Note: QDrant container doesn't have curl or wget, so we rely on ALB health checks
      portMappings: [
        { containerPort: 6333, protocol: ecs.Protocol.TCP }, // REST API
        { containerPort: 6334, protocol: ecs.Protocol.TCP }, // gRPC
        ...(config.qdrant.nodeCount > 1
          ? [{ containerPort: 6335, protocol: ecs.Protocol.TCP }] // P2P
          : []),
      ],
    });

    // Mount EFS volume
    container.addMountPoints({
      sourceVolume: "qdrant-storage",
      containerPath: "/qdrant/storage",
      readOnly: false,
    });

    // Create Fargate service
    this.service = new ecs.FargateService(this, "Service", {
      serviceName: `argus-vector-${environment}-qdrant`,
      cluster: this.cluster,
      taskDefinition,
      desiredCount: config.qdrant.nodeCount,
      securityGroups: [securityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      assignPublicIp: false,
      platformVersion: ecs.FargatePlatformVersion.LATEST,
      enableExecuteCommand: stage !== "prod", // Allow exec for debugging in non-prod
      minHealthyPercent: 100, // Don't reduce running tasks during deployments
      maxHealthyPercent: 200, // Allow double capacity during deployments
      cloudMapOptions: namespace
        ? {
            name: "qdrant",
            cloudMapNamespace: namespace,
            dnsRecordType: servicediscovery.DnsRecordType.A,
            dnsTtl: cdk.Duration.seconds(10),
          }
        : undefined,
    });

    // Create Application Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      loadBalancerName: `argus-vector-${environment}-alb`,
      vpc,
      internetFacing: false, // Internal only - access via VPC
      securityGroup: this.createAlbSecurityGroup(vpc, environment),
    });

    // REST API listener (6333)
    const restListener = this.loadBalancer.addListener("RestListener", {
      port: 6333,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    restListener.addTargets("RestTarget", {
      port: 6333,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
      healthCheck: {
        path: "/",
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Note: gRPC requires HTTPS on ALB. For gRPC access, use service discovery
    // or access the ECS tasks directly. The REST API (port 6333) is sufficient
    // for most QDrant operations.

    // Tags
    cdk.Tags.of(this).add("Environment", environment);
    cdk.Tags.of(this).add("Service", "argus-vector");
  }

  private createAlbSecurityGroup(
    vpc: ec2.IVpc,
    environment: string
  ): ec2.SecurityGroup {
    const sg = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc,
      securityGroupName: `argus-vector-${environment}-alb-sg`,
      description: "Security group for QDrant ALB",
      allowAllOutbound: true,
    });

    // Allow REST API access from within VPC
    sg.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(6333),
      "QDrant REST API"
    );

    return sg;
  }
}
