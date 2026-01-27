import { describe, it, expect } from "vitest";
import { getEnvironmentConfig } from "../lib/config";

/**
 * Stack tests are currently skipped because:
 * 1. The stack now imports VPC from ms-argus-infra via SSM lookup
 * 2. Vpc.fromLookup() requires actual AWS context to resolve
 * 3. These tests would need to be run as integration tests with real AWS credentials
 *
 * The config tests in config.test.ts provide coverage for the configuration logic.
 * Full stack testing should be done via CDK synth with proper AWS context.
 */

describe("ArgusVectorStack", () => {
  const testAccount = "123456789012";
  const testRegion = "us-east-1";

  describe("Configuration", () => {
    it("creates valid qa config for stack", () => {
      const config = getEnvironmentConfig("qa", "qa", testAccount, testRegion);

      expect(config.environment).toBe("qa");
      expect(config.stage).toBe("qa");
      expect(config.qdrant.nodeCount).toBe(1);
    });

    it("creates valid prod config for stack", () => {
      const config = getEnvironmentConfig("prod", "prod", testAccount, testRegion);

      expect(config.environment).toBe("prod");
      expect(config.stage).toBe("prod");
      expect(config.qdrant.nodeCount).toBe(3);
    });

    it("creates valid dev config with qa stage sizing", () => {
      const config = getEnvironmentConfig("dev-jw", "qa", testAccount, testRegion);

      expect(config.environment).toBe("dev-jw");
      expect(config.stage).toBe("qa");
      expect(config.qdrant.nodeCount).toBe(1);
      expect(config.qdrant.cpu).toBe(512);
    });
  });

  // TODO: Add integration tests that run with real AWS context
  // describe.skip("QA Environment - Integration", () => { ... });
  // describe.skip("Prod Environment - Integration", () => { ... });
});
