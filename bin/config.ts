/**
 * Shared configuration for CDK stacks
 */

export const AWS_ACCOUNT_ID: string =
  process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID || "";

export const AWS_REGION: string =
  process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1";

export const PROJECT_NAME = "ms-argus-vector";

/**
 * CodeStar connection ARN for GitHub integration
 * Set via environment variable or provide directly
 */
export const CODESTAR_CONNECTION_ARN: string =
  process.env.CODESTAR_CONNECTION_ARN || "";

/**
 * GitHub repository configuration
 */
export const GITHUB_OWNER = "your-org"; // Update this
export const GITHUB_REPO = "ms-argus-vector";
export const GITHUB_BRANCH = "main";
