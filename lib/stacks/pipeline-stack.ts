import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codecommit from "aws-cdk-lib/aws-codecommit";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";

export interface PipelineStackProps extends cdk.StackProps {
  /**
   * AWS account ID for deployments
   */
  account: string;

  /**
   * AWS region for deployments
   */
  region: string;

  /**
   * Repository name (will be created if it doesn't exist)
   */
  repositoryName?: string;

  /**
   * Use existing CodeCommit repo (provide ARN) instead of creating new
   */
  existingRepoArn?: string;

  /**
   * Use GitHub instead of CodeCommit
   */
  github?: {
    owner: string;
    repo: string;
    branch: string;
    connectionArn: string; // CodeStar connection ARN
  };
}

/**
 * CI/CD Pipeline stack for Argus Vector.
 * Deploys to QA -> Uat -> Prod with manual approval gates.
 */
export class PipelineStack extends cdk.Stack {
  public readonly pipeline: codepipeline.Pipeline;
  public readonly notificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, {
      ...props,
      description: "CI/CD Pipeline for Argus Vector (QDrant) infrastructure",
    });

    const { account, region } = props;

    // Create SNS topic for pipeline notifications
    this.notificationTopic = new sns.Topic(this, "PipelineNotifications", {
      topicName: "argus-vector-pipeline-notifications",
      displayName: "Argus Vector Pipeline Notifications",
    });

    // Source artifact
    const sourceOutput = new codepipeline.Artifact("SourceOutput");
    const cdkOutput = new codepipeline.Artifact("CdkOutput");

    // Determine source action
    let sourceAction: codepipeline.IAction;

    if (props.github) {
      // GitHub source
      sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
        actionName: "GitHub_Source",
        owner: props.github.owner,
        repo: props.github.repo,
        branch: props.github.branch,
        connectionArn: props.github.connectionArn,
        output: sourceOutput,
        triggerOnPush: true,
      });
    } else {
      // CodeCommit source
      let repository: codecommit.IRepository;

      if (props.existingRepoArn) {
        repository = codecommit.Repository.fromRepositoryArn(
          this,
          "Repository",
          props.existingRepoArn
        );
      } else {
        repository = new codecommit.Repository(this, "Repository", {
          repositoryName: props.repositoryName || "ms-argus-vector",
          description: "Argus Vector (QDrant) CDK Infrastructure",
        });

        new cdk.CfnOutput(this, "RepositoryCloneUrl", {
          value: repository.repositoryCloneUrlHttp,
          description: "CodeCommit repository clone URL",
        });
      }

      sourceAction = new codepipeline_actions.CodeCommitSourceAction({
        actionName: "CodeCommit_Source",
        repository,
        branch: "main",
        output: sourceOutput,
        trigger: codepipeline_actions.CodeCommitTrigger.EVENTS,
      });
    }

    // Build project for CDK synth
    const synthProject = new codebuild.PipelineProject(this, "SynthProject", {
      projectName: "argus-vector-cdk-synth",
      description: "Synthesize CDK templates for Argus Vector",
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        CDK_DEFAULT_ACCOUNT: { value: account },
        CDK_DEFAULT_REGION: { value: region },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            "runtime-versions": {
              nodejs: "20",
            },
            commands: ["npm ci"],
          },
          build: {
            commands: [
              "npm run build",
              "npm run lint",
              "npm run test -- --run",
              "npx cdk synth --all",
            ],
          },
        },
        artifacts: {
          "base-directory": "cdk.out",
          files: ["**/*"],
        },
      }),
    });

    // Create the pipeline
    this.pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: "argus-vector-pipeline",
      crossAccountKeys: false,
      restartExecutionOnUpdate: true,
    });

    // Source stage
    this.pipeline.addStage({
      stageName: "Source",
      actions: [sourceAction],
    });

    // Build stage
    this.pipeline.addStage({
      stageName: "Build",
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "CDK_Synth",
          project: synthProject,
          input: sourceOutput,
          outputs: [cdkOutput],
        }),
      ],
    });

    // Deploy to QA
    this.pipeline.addStage({
      stageName: "Deploy_QA",
      actions: [
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: "Deploy_QA_Stack",
          stackName: "ms-argus-vector-qa",
          templatePath: cdkOutput.atPath("ArgusVector-QA.template.json"),
          adminPermissions: true,
          cfnCapabilities: [
            cdk.CfnCapabilities.NAMED_IAM,
            cdk.CfnCapabilities.AUTO_EXPAND,
          ],
        }),
      ],
    });

    // Manual approval for Uat
    this.pipeline.addStage({
      stageName: "Approve_Uat",
      actions: [
        new codepipeline_actions.ManualApprovalAction({
          actionName: "Approve_Uat_Deploy",
          notificationTopic: this.notificationTopic,
          additionalInformation:
            "Please review the QA deployment and approve for Uat.",
        }),
      ],
    });

    // Deploy to Uat
    this.pipeline.addStage({
      stageName: "Deploy_Uat",
      actions: [
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: "Deploy_Uat_Stack",
          stackName: "ms-argus-vector-uat",
          templatePath: cdkOutput.atPath("ArgusVector-Uat.template.json"),
          adminPermissions: true,
          cfnCapabilities: [
            cdk.CfnCapabilities.NAMED_IAM,
            cdk.CfnCapabilities.AUTO_EXPAND,
          ],
        }),
      ],
    });

    // Manual approval for Production
    this.pipeline.addStage({
      stageName: "Approve_Prod",
      actions: [
        new codepipeline_actions.ManualApprovalAction({
          actionName: "Approve_Prod_Deploy",
          notificationTopic: this.notificationTopic,
          additionalInformation:
            "Please review the Uat deployment and approve for Production. This will deploy a 3-node QDrant cluster.",
        }),
      ],
    });

    // Deploy to Production
    this.pipeline.addStage({
      stageName: "Deploy_Prod",
      actions: [
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: "Deploy_Prod_Stack",
          stackName: "ms-argus-vector-prod",
          templatePath: cdkOutput.atPath("ArgusVector-Prod.template.json"),
          adminPermissions: true,
          cfnCapabilities: [
            cdk.CfnCapabilities.NAMED_IAM,
            cdk.CfnCapabilities.AUTO_EXPAND,
          ],
        }),
      ],
    });

    // Grant synth project permissions for CDK
    synthProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "sts:AssumeRole",
          "iam:PassRole",
        ],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "iam:ResourceTag/aws-cdk:bootstrap-role": [
              "lookup",
              "file-publishing",
              "image-publishing",
              "deploy",
            ],
          },
        },
      })
    );

    // Outputs
    new cdk.CfnOutput(this, "PipelineArn", {
      value: this.pipeline.pipelineArn,
      description: "CodePipeline ARN",
    });

    new cdk.CfnOutput(this, "NotificationTopicArn", {
      value: this.notificationTopic.topicArn,
      description: "SNS topic for pipeline notifications (subscribe for approval emails)",
    });
  }
}
