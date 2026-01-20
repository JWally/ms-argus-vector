import { describe, it, expect } from "vitest";
import {
  getEnvironmentConfig,
  resourceName,
  type EnvironmentName,
} from "../lib/config";

describe("Environment Configuration", () => {
  const testAccount = "123456789012";
  const testRegion = "us-east-1";

  describe("getEnvironmentConfig", () => {
    it("returns correct qa configuration", () => {
      const config = getEnvironmentConfig("qa", testAccount, testRegion);

      expect(config.name).toBe("qa");
      expect(config.env.account).toBe(testAccount);
      expect(config.env.region).toBe(testRegion);
      expect(config.qdrant.nodeCount).toBe(1);
      expect(config.qdrant.cpu).toBe(512);
      expect(config.qdrant.memoryMiB).toBe(1024);
      expect(config.qdrant.imageTag).toBe("latest");
      expect(config.vpc.maxAzs).toBe(2);
      expect(config.vpc.natGateways).toBe(1);
      expect(config.efs.enableBackups).toBe(false);
    });

    it("returns correct uat configuration", () => {
      const config = getEnvironmentConfig("uat", testAccount, testRegion);

      expect(config.name).toBe("uat");
      expect(config.qdrant.nodeCount).toBe(1);
      expect(config.qdrant.cpu).toBe(1024);
      expect(config.qdrant.memoryMiB).toBe(2048);
      expect(config.efs.enableBackups).toBe(true);
    });

    it("returns correct prod configuration with cluster", () => {
      const config = getEnvironmentConfig("prod", testAccount, testRegion);

      expect(config.name).toBe("prod");
      expect(config.qdrant.nodeCount).toBe(3);
      expect(config.qdrant.cpu).toBe(2048);
      expect(config.qdrant.memoryMiB).toBe(4096);
      expect(config.qdrant.imageTag).toBe("v1.12.6");
      expect(config.vpc.maxAzs).toBe(3);
      expect(config.vpc.natGateways).toBe(3);
      expect(config.efs.enableBackups).toBe(true);
    });

    it("throws error for unknown environment", () => {
      expect(() =>
        getEnvironmentConfig("invalid" as EnvironmentName, testAccount, testRegion)
      ).toThrow("Unknown environment: invalid");
    });

    it("uses default region when not specified", () => {
      const config = getEnvironmentConfig("qa", testAccount);

      expect(config.env.region).toBe("us-east-1");
    });
  });

  describe("resourceName", () => {
    it("creates correct resource name for qa", () => {
      expect(resourceName("qa", "vpc")).toBe("argus-vector-qa-vpc");
    });

    it("creates correct resource name for uat", () => {
      expect(resourceName("uat", "ecs-cluster")).toBe(
        "argus-vector-uat-ecs-cluster"
      );
    });

    it("creates correct resource name for prod", () => {
      expect(resourceName("prod", "alb")).toBe("argus-vector-prod-alb");
    });
  });
});
