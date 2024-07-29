const cdk = require('aws-cdk-lib');
const { Stack, SecretValue, Stage } = require('aws-cdk-lib');
const codepipeline = require('aws-cdk-lib/aws-codepipeline');
const codepipeline_actions = require('aws-cdk-lib/aws-codepipeline-actions');
const codebuild = require('aws-cdk-lib/aws-codebuild');
const codedeploy = require('aws-cdk-lib/aws-codedeploy');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const logs = require('aws-cdk-lib/aws-logs');

class WebCrawlerPipelineStack extends Stack {
    constructor(scope, id, props) {
        super(scope, id, props);

        const sourceOutput = new codepipeline.Artifact();
        const buildOutput = new codepipeline.Artifact();

        // GitHub Source Action
        const sourceAction = new codepipeline_actions.GitHubSourceAction({
            actionName: 'GitHub_Source',
            owner: 'Joseph-Swift',
            repo: 'Cloud-Monitoring-App',
            branch: 'main',
            oauthToken: SecretValue.secretsManager('github-token'),
            output: sourceOutput
        });

        // CodeBuild Project for build and test with CloudWatch Logs
        const buildProject = new codebuild.PipelineProject(this, 'WebCrawlerBuild', {
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
                computeType: codebuild.ComputeType.SMALL,
                environmentVariables: {
                    NODE_ENV: { value: 'production' }
                }
            },
            logging: { // Logging configuration for CloudWatch
                cloudWatch: {
                    logGroup: new logs.LogGroup(this, 'BuildLogs', {
                        logGroupName: '/aws/codebuild/WebCrawlerBuild',
                        retention: logs.RetentionDays.ONE_MONTH, // Adjust retention as necessary
                        removalPolicy: cdk.RemovalPolicy.DESTROY // Automatically remove if the stack is destroyed
                    }),
                    prefix: 'BuildLogs'
                }
            }
        });

        const buildAction = new codepipeline_actions.CodeBuildAction({
            actionName: 'Build_and_Test',
            project: buildProject,
            input: sourceOutput,
            outputs: [buildOutput],
            runOrder: 1
        });

        // Approval action for manual review
        const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
            actionName: 'Code_Review',
            runOrder: 2
        });

        // Beta and Gamma deployment stages with detailed CloudWatch Logs for CloudFormation
        const betaStage = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'Beta_Deploy',
            templatePath: buildOutput.atPath('WebCrawlerStack.template.json'),
            stackName: 'WebCrawlerStack-Beta',
            adminPermissions: true,
            runOrder: 3,
            extraInputs: [buildOutput],
            deploymentRole: canaryRole
        });

        const gammaStage = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'Gamma_Deploy',
            templatePath: buildOutput.atPath('WebCrawlerStack.template.json'),
            stackName: 'WebCrawlerStack-Gamma',
            adminPermissions: true,
            runOrder: 4,
            extraInputs: [buildOutput],
            deploymentRole: canaryRole
        });

        // Prod Deployment stage
        const prodStage = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'Prod_Deploy',
            templatePath: buildOutput.atPath('WebCrawlerStack.template.json'),
            stackName: 'WebCrawlerStack-Prod',
            adminPermissions: true
        });

        // Pipeline definition with separate production stage
        new codepipeline.Pipeline(this, 'WebCrawlerPipeline', {
            pipelineName: 'WebCrawlerPipeline',
            stages: [
                {
                    stageName: 'Source',
                    actions: [sourceAction]
                },
                {
                    stageName: 'Build_and_Test',
                    actions: [buildAction, manualApprovalAction, betaStage, gammaStage]
                },
                {
                    stageName: 'Prod_Deploy',
                    actions: [prodStage]
                }
            ]
        });
    }
}

module.exports = { WebCrawlerPipelineStack };