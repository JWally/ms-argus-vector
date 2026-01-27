import { Construct } from "constructs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cdk from "aws-cdk-lib";
import type { EnvironmentConfig } from "../config";

export interface ArgusStorageProps {
  config: EnvironmentConfig;
  vpc: ec2.IVpc;
  securityGroup: ec2.ISecurityGroup;
}

/**
 * EFS storage construct for QDrant data persistence.
 * Creates an EFS file system with appropriate lifecycle policies and backup settings.
 */
export class ArgusStorage extends Construct {
  public readonly fileSystem: efs.FileSystem;
  public readonly accessPoint: efs.IAccessPoint;

  constructor(scope: Construct, id: string, props: ArgusStorageProps) {
    super(scope, id);

    const { config, vpc, securityGroup } = props;
    const { environment, stage } = config;

    // Create EFS file system
    const fs = new efs.FileSystem(this, "FileSystem", {
      fileSystemName: `argus-vector-${environment}-efs`,
      vpc,
      securityGroup,
      encrypted: true,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy:
        stage === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      enableAutomaticBackups: config.efs.enableBackups,
      lifecyclePolicy:
        config.efs.lifecycleInfrequentAccessDays > 0
          ? this.getLifecyclePolicy(config.efs.lifecycleInfrequentAccessDays)
          : undefined,
      outOfInfrequentAccessPolicy:
        config.efs.lifecycleInfrequentAccessDays > 0
          ? efs.OutOfInfrequentAccessPolicy.AFTER_1_ACCESS
          : undefined,
    });

    this.fileSystem = fs;

    // Create access point for QDrant storage
    // Using POSIX user 1000:1000 (qdrant default user in container)
    this.accessPoint = fs.addAccessPoint("QdrantAccessPoint", {
      path: "/qdrant-storage",
      createAcl: {
        ownerGid: "1000",
        ownerUid: "1000",
        permissions: "755",
      },
      posixUser: {
        gid: "1000",
        uid: "1000",
      },
    });

    // Tags
    cdk.Tags.of(this).add("Environment", environment);
    cdk.Tags.of(this).add("Service", "argus-vector");
  }

  private getLifecyclePolicy(
    days: number
  ): efs.LifecyclePolicy | undefined {
    switch (days) {
      case 7:
        return efs.LifecyclePolicy.AFTER_7_DAYS;
      case 14:
        return efs.LifecyclePolicy.AFTER_14_DAYS;
      case 30:
        return efs.LifecyclePolicy.AFTER_30_DAYS;
      case 60:
        return efs.LifecyclePolicy.AFTER_60_DAYS;
      case 90:
        return efs.LifecyclePolicy.AFTER_90_DAYS;
      default:
        return efs.LifecyclePolicy.AFTER_30_DAYS;
    }
  }
}
