import { describe, it } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { ArgusVectorStack } from "../lib/stacks";
import { getEnvironmentConfig } from "../lib/config";

describe("ArgusVectorStack", () => {
  const testAccount = "123456789012";
  const testRegion = "us-east-1";

  describe("QA Environment", () => {
    const app = new cdk.App();
    const config = getEnvironmentConfig("qa", testAccount, testRegion);
    const stack = new ArgusVectorStack(app, "TestQaStack", { config });
    const template = Template.fromStack(stack);

    it("creates a VPC with correct configuration", () => {
      template.hasResourceProperties("AWS::EC2::VPC", {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    it("creates 1 NAT Gateway for qa", () => {
      template.resourceCountIs("AWS::EC2::NatGateway", 1);
    });

    it("creates an EFS file system", () => {
      template.hasResourceProperties("AWS::EFS::FileSystem", {
        Encrypted: true,
      });
    });

    it("creates an ECS cluster", () => {
      template.hasResource("AWS::ECS::Cluster", {});
    });

    it("creates a Fargate task definition with correct resources", () => {
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Cpu: "512",
        Memory: "1024",
        RequiresCompatibilities: ["FARGATE"],
        NetworkMode: "awsvpc",
      });
    });

    it("creates a single task Fargate service for qa", () => {
      template.hasResourceProperties("AWS::ECS::Service", {
        DesiredCount: 1,
        LaunchType: "FARGATE",
      });
    });

    it("creates an Application Load Balancer", () => {
      template.hasResourceProperties(
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
        {
          Scheme: "internal",
          Type: "application",
        }
      );
    });

    it("creates REST API listener", () => {
      template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
        Port: 6333,
      });
    });

    it("creates a Secrets Manager secret for API key", () => {
      template.hasResourceProperties("AWS::SecretsManager::Secret", {
        Description: Match.stringLikeRegexp("QDrant API key"),
      });
    });

    it("creates correct outputs", () => {
      template.hasOutput("ClusterArn", {});
      template.hasOutput("ServiceArn", {});
      template.hasOutput("LoadBalancerDns", {});
      template.hasOutput("QdrantRestEndpoint", {});
      template.hasOutput("ApiSecretArn", {});
    });
  });

  describe("Prod Environment", () => {
    const app = new cdk.App();
    const config = getEnvironmentConfig("prod", testAccount, testRegion);
    const stack = new ArgusVectorStack(app, "TestProdStack", { config });
    const template = Template.fromStack(stack);

    it("creates 3 NAT Gateways for prod", () => {
      template.resourceCountIs("AWS::EC2::NatGateway", 3);
    });

    it("creates a Fargate task definition with prod resources", () => {
      template.hasResourceProperties("AWS::ECS::TaskDefinition", {
        Cpu: "2048",
        Memory: "4096",
      });
    });

    it("creates a 3-node Fargate service for prod", () => {
      template.hasResourceProperties("AWS::ECS::Service", {
        DesiredCount: 3,
      });
    });

    it("creates a Cloud Map namespace for cluster discovery", () => {
      template.hasResourceProperties(
        "AWS::ServiceDiscovery::PrivateDnsNamespace",
        {
          Name: "qdrant.prod.local",
        }
      );
    });

    it("has Container Insights enabled", () => {
      template.hasResourceProperties("AWS::ECS::Cluster", {
        ClusterSettings: Match.arrayWith([
          {
            Name: "containerInsights",
            Value: "enabled",
          },
        ]),
      });
    });

    it("sets RETAIN removal policy for EFS", () => {
      template.hasResource("AWS::EFS::FileSystem", {
        DeletionPolicy: "Retain",
        UpdateReplacePolicy: "Retain",
      });
    });
  });
});
