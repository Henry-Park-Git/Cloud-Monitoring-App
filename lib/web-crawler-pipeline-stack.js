const cdk = require('aws-cdk-lib');
const { Stack, SecretValue } = require('aws-cdk-lib');
const codepipeline = require('aws-cdk-lib/aws-codepipeline');
const codepipeline_actions = require('aws-cdk-lib/aws-codepipeline-actions');
const codebuild = require('aws-cdk-lib/aws-codebuild');

class WebCrawlerPipelineStack extends Stack {
    constructor(scope, id, props) {
        super(scope, id, props);

        const sourceOutput = new codepipeline.Artifact();
        const buildOutput = new codepipeline.Artifact();

        // GitHub Source Action
        const sourceAction = new codepipeline_actions.GitHubSourceAction({
            actionName: 'GitHub_Source',
            owner: 'Joseph-Swift', // GitHub 사용자 이름
            repo: 'Cloud-Monitoring-App', // GitHub 저장소 이름
            branch: 'main',
            oauthToken: SecretValue.secretsManager('github-token'), // AWS Secrets Manager 비밀 이름
            output: sourceOutput
        });

        // CodeBuild Project
        const project = new codebuild.PipelineProject(this, 'WebCrawlerBuild', {
            buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
                computeType: codebuild.ComputeType.SMALL,
                environmentVariables: {
                    NODE_ENV: { value: 'production' }
                }
            }
        });

        const buildAction = new codepipeline_actions.CodeBuildAction({
            actionName: 'CodeBuild',
            project,
            input: sourceOutput,
            outputs: [buildOutput]
        });

        // Pipeline
        new codepipeline.Pipeline(this, 'WebCrawlerPipeline', {
            pipelineName: 'WebCrawlerPipeline',
            stages: [
                {
                    stageName: 'Source',
                    actions: [sourceAction]
                },
                {
                    stageName: 'Build',
                    actions: [buildAction]
                },
                {
                    stageName: 'Deploy',
                    actions: [
                        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                            actionName: 'Deploy',
                            templatePath: buildOutput.atPath('WebCrawlerStack.template.json'),
                            stackName: 'WebCrawlerStack',
                            adminPermissions: true
                        })
                    ]
                }
            ]
        });
    }
}

module.exports = { WebCrawlerPipelineStack };
