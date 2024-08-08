const cdk = require('aws-cdk-lib');
const { Stack, SecretValue } = require('aws-cdk-lib');
const codepipeline = require('aws-cdk-lib/aws-codepipeline');
const codepipeline_actions = require('aws-cdk-lib/aws-codepipeline-actions');
const codebuild = require('aws-cdk-lib/aws-codebuild');
const iam = require('aws-cdk-lib/aws-iam');
const logs = require('aws-cdk-lib/aws-logs');

class WebCrawlerPipelineStack extends Stack {
    constructor(scope, id, props) {
        super(scope, id, props);

        const sourceOutput = new codepipeline.Artifact();
        const buildOutput = new codepipeline.Artifact();

        // CodeBuild Project for build and test with CloudWatch Logs
        const buildProject = new codebuild.PipelineProject(this, 'WebCrawlerBuild', {
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
                computeType: codebuild.ComputeType.SMALL,
            },
            logging: {
                cloudWatch: {
                    logGroup: new logs.LogGroup(this, 'BuildLogs', {
                        logGroupName: '/aws/codebuild/WebCrawlerBuild',
                        retention: logs.RetentionDays.ONE_MONTH,
                        removalPolicy: cdk.RemovalPolicy.DESTROY
                    }),
                    prefix: 'BuildLogs'
                }
            }
        });

        // Pipeline Role
        const pipelineRole = new iam.Role(this, 'PipelineRole', {
            assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
        });

        // Deployment Role
        const deploymentRole = new iam.Role(this, 'DeploymentRole', {
            assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com'),
        });

        // Allow PipelineRole to assume DeploymentRole
        deploymentRole.assumeRolePolicy.addStatements(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.ArnPrincipal(pipelineRole.roleArn)],
            actions: ['sts:AssumeRole'],
        }));

        // Permissions for DeploymentRole
        deploymentRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'cloudformation:*',
                's3:*',
                'lambda:*',
                'iam:*',
                'ec2:*',
                'logs:*'
            ],
            resources: ['*'],
        }));

        // GitHub Source Action
        const sourceAction = new codepipeline_actions.GitHubSourceAction({
            actionName: 'GitHub_Source',
            owner: 'Joseph-Swift',
            repo: 'Cloud-Monitoring-App',
            branch: 'main',
            oauthToken: SecretValue.secretsManager('github-token'),
            output: sourceOutput,
        });

        const buildAction = new codepipeline_actions.CodeBuildAction({
            actionName: 'Build_and_Test',
            project: buildProject,
            input: sourceOutput,
            outputs: [buildOutput],
            role: pipelineRole,
            runOrder: 1,
        });

        const manualApprovalAction = new codepipeline_actions.ManualApprovalAction({
            actionName: 'Code_Review',
            role: pipelineRole,
            runOrder: 2,
        });

        const prodStage = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'Prod_Deploy',
            templatePath: buildOutput.atPath('WebCrawlerStack.template.json'),
            stackName: 'WebCrawlerStack-Prod',
            adminPermissions: true,
            role: deploymentRole,
        });

        new codepipeline.Pipeline(this, 'WebCrawlerPipeline', {
            pipelineName: 'WebCrawlerPipeline',
            stages: [
                { stageName: 'Source', actions: [sourceAction] },
                { stageName: 'Build_and_Test', actions: [buildAction, manualApprovalAction] },
                { stageName: 'Prod_Deploy', actions: [prodStage] },
            ],
            role: pipelineRole,
        });
    }
}

module.exports = { WebCrawlerPipelineStack };