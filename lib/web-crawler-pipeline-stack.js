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

        // GitHub Source Action
        const sourceAction = new codepipeline_actions.GitHubSourceAction({
            actionName: 'GitHub_Source',
            owner: 'Joseph-Swift',
            repo: 'Cloud-Monitoring-App',
            branch: 'main',
            oauthToken: SecretValue.secretsManager('github-token'),
            output: sourceOutput
        });

        const buildRole = new iam.Role(this, 'BuildRole', {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'), // Example of a managed policy
            ],
        });

        buildRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'cloudformation:*',
            ],
            resources: ['arn:aws:cloudformation:ap-southeast-2:*:stack/*'],
        }));

        buildRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                'ssm:PutParameter'
            ],
            resources: ['arn:aws:ssm:ap-southeast-2:*:parameter/cdk-bootstrap/*'],
        }));

        buildRole.addToPolicy(new iam.PolicyStatement({
            actions: [
              'iam:GetRole',
              'iam:PutRolePolicy',
              'iam:ListAttachedRolePolicies',
              'iam:ListRolePolicies'
            ],
            resources: [
              'arn:aws:iam::654654562060:role/*',
            ],
          }));
          
        // CodeBuild Project for build and test
        const buildProject = new codebuild.PipelineProject(this, 'WebCrawlerBuild', {
            role: buildRole,
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
                computeType: codebuild.ComputeType.SMALL,
                environmentVariables: {
                    NODE_ENV: { value: 'production' }
                }
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

        // Build action
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

        // Deployment IAM role
        const deploymentRole = new iam.Role(this, 'DeploymentRole', {
            assumedBy: new iam.ServicePrincipal('cloudformation.amazonaws.com')
        });

        // Pipeline role
        const pipelineRole = new iam.Role(this, 'PipelineRole', {
            assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com')
        });

        // Trust relationship to allow PipelineRole to assume DeploymentRole
        deploymentRole.assumeRolePolicy?.addStatements(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.ArnPrincipal(pipelineRole.roleArn)],
            actions: ['sts:AssumeRole']
        }));

        // Prod Deployment stage
        const prodStage = new codepipeline_actions.CloudFormationCreateUpdateStackAction({
            actionName: 'Prod_Deploy',
            templatePath: buildOutput.atPath('WebCrawlerStack.json'),
            stackName: 'WebCrawlerStack-Production',
            adminPermissions: true,
            role: deploymentRole,
        });

        // Pipeline configuration
        new codepipeline.Pipeline(this, 'WebCrawlerPipeline', {
            pipelineName: 'WebCrawlerPipeline',
            stages: [
                { stageName: 'Source', actions: [sourceAction] },
                { stageName: 'Build_and_Test', actions: [buildAction, manualApprovalAction] },
                { stageName: 'Prod_Deploy', actions: [prodStage] }
            ],
            role: pipelineRole
        });
    }
}

module.exports = { WebCrawlerPipelineStack };