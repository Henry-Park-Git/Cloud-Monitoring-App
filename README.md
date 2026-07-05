# Cloud Monitoring App

> Synthetic uptime and latency monitoring for a configurable list of websites, built entirely as AWS CDK infrastructure-as-code, with its own self-deploying CI/CD pipeline.

## Overview

Cloud Monitoring App watches a list of external websites, checks that each one loads successfully, and measures how long it takes — without any always-on server to maintain. A CloudWatch Synthetics canary runs headless Chrome (Puppeteer) on a schedule, and CloudWatch Alarms turn "site is slow" or "site is down" into a notification within minutes.

What makes it more than a wrapper around a canary is the rest of the system built around that one signal: the monitored URL list is decoupled from the code so sites can be added without a deploy, every alarm state change is persisted to DynamoDB for a durable audit trail (not just a fleeting email), and the whole thing ships through its own CDK-defined CodePipeline with a test gate and a manual approval step before production.

## Tech Stack

**Infrastructure as Code**
- AWS CDK (`aws-cdk-lib` v2) in JavaScript — one CDK app, two independently deployable stacks

**Monitoring**
- AWS CloudWatch Synthetics (Puppeteer runtime `syn-nodejs-puppeteer-7.0`) — the canary
- AWS CloudWatch Metrics & Alarms
- `@aws-sdk/client-cloudwatch` (v3) — used inside the canary to publish custom metrics

**Compute & Messaging**
- AWS Lambda (Node.js 18.x) — alarm processor
- AWS SNS — alarm fan-out (email + Lambda subscriptions)
- `aws-sdk` (v2) — DynamoDB DocumentClient in the Lambda, S3 client in the config-fetch script

**Data & Storage**
- Amazon DynamoDB — alarm state-change history
- Amazon S3 — canary screenshot/log artifacts, and the externally-hosted `urls.json` target list

**CI/CD**
- AWS CodePipeline + CodeBuild, GitHub source action, manual approval gate

**Testing**
- Jest + `aws-cdk-lib/assertions` — assertions against the synthesized CloudFormation template, not just unit logic

## Key Features

- **Multi-site monitoring from one canary** — the canary reads a name→URL map at runtime and loops over every entry, so it scales to any number of monitored sites without adding new CDK resources per site.
- **Target list decoupled from source** — `urls.json` is fetched from S3 (`fetch-s3-data.js`) before the stack synthesizes, so operators can add or remove a monitored site without touching code or waiting for a PR.
- **Per-site alarms generated dynamically** — for every URL, the stack derives an availability alarm (success rate < 90%) and a latency alarm (> 3000 ms) from a shared metrics factory ([`lib/metrics.js`](lib/metrics.js)), keeping alarm definitions consistent as the URL list grows.
- **Two-channel alerting with a durable trail** — a single SNS topic fans out to both a human (email) and a Lambda function, so a failure produces an immediate notification *and* a permanent DynamoDB record of what changed and why.
- **Health metrics on the canary itself** — beyond per-site availability/latency, the canary publishes its own `TimeToProcess` and `MemoryUsage`, each with its own alarm, so a slow or resource-heavy canary run is caught independently of the sites it's checking.
- **Infrastructure tested like application code** — CDK assertions verify the synthesized CloudFormation (bucket naming, canary schedule/runtime, table keys, alarm thresholds) in CI before every deploy, not after.

## Architecture

```
 urls.json (S3: target site list)
        │  fetched pre-build by fetch-s3-data.js
        ▼
 ┌───────────────────────────────────────────┐
 │  WebCrawlerStack (CDK)                     │
 │                                             │
 │  Synthetics Canary — every 2 minutes        │
 │  Puppeteer: goto → screenshot → timing  ────┼──▶ CloudWatch Metrics
 │                                             │    (Availability, Latency per URL,
 │                                             │     TimeToProcess, MemoryUsage)
 └───────────────────┬─────────────────────────┘
                      │ per-URL alarms built from lib/metrics.js
                      ▼
            CloudWatch Alarms
            (Availability < 90%  ·  Latency > 3000ms
             TimeToProcess > 10s  ·  MemoryUsage > 100MB)
                      │ ALARM state
                      ▼
              SNS Topic (AlarmTopic)
               ├──────────────┐
               ▼              ▼
        Email subscriber   AlarmProcessorFunction (Lambda)
                                    │
                                    ▼
                          DynamoDB table `AlarmData`
                          (AlarmName, StateChange, Reason, Timestamp)
```

A second, independent stack owns delivery:

```
 GitHub push (main)
        ▼
 CodePipeline
   Source ──▶ Build_and_Test ──▶ Manual Approval ──▶ Prod Deploy
              (CodeBuild:                              (CloudFormation
               npm test,                                 create/update via
               fetch-s3-data.js,                          a scoped
               cdk synth)                                 DeploymentRole)
```

**Key design decisions**

- **Two stacks from one CDK app, not one.** `WebCrawlerStack` (the monitoring resources) and `WebCrawlerPipelineStack` (the delivery mechanism) are deployed independently from [`bin/web-crawler.js`](bin/web-crawler.js). A change to the pipeline's build image or approval flow never forces a canary redeploy, and vice versa.
- **Config lives in S3, not in git.** The monitored-site list could have been hardcoded in the stack; instead it's pulled from S3 at build time. That means non-engineers can change what's monitored without a code review, at the cost of one step that lives outside version control — a deliberate trade-off between change velocity and auditability.
- **A metrics factory instead of per-URL boilerplate.** [`lib/metrics.js`](lib/metrics.js) centralises the CloudWatch namespace/dimension definitions used by every alarm. Without it, the `forEach` over URLs in [`lib/web-crawler-stack.js`](lib/web-crawler-stack.js) would duplicate metric wiring for each site and drift out of sync as sites are added.
- **Alarm history is fanned out from SNS, not bolted onto the alarm.** Rather than teaching the canary or the alarm itself to write to a database, a single SNS topic delivers the same event to both an email subscriber and the `AlarmProcessorFunction` Lambda. Notification and persistence are independent concerns that can fail or be extended separately.
- **Least-privilege cross-role trust in the pipeline.** The pipeline's own execution role (`PipelineRole`) doesn't get admin rights to deploy — instead a separate `DeploymentRole` is created with an explicit `sts:AssumeRole` trust statement scoped to `PipelineRole`, and only that role touches CloudFormation in production.
- **A human gate between tests passing and production.** Unit tests run automatically in `pre_build` (so broken infra fails fast), but the `Code_Review` manual approval action still has to be actioned before `Prod_Deploy` runs — CI catches regressions, a person authorises the production change.

## How It Works

The canary is the core of the system, so it's worth walking through end to end (implementation in [`canary/nodejs/node_modules/index.js`](canary/nodejs/node_modules/index.js) — it lives under `node_modules` because that's the path AWS Synthetics' custom-runtime packaging convention expects the canary script to be discoverable from):

1. **Trigger.** CloudWatch Synthetics invokes the canary handler every 2 minutes (`synthetics.Schedule.rate(Duration.minutes(2))`), passing the URL map in via the `URLS` environment variable set by the CDK stack.
2. **Visit each site.** For every `[name, url]` pair, the canary opens a Synthetics-managed Puppeteer page, navigates with a 30-second timeout, and takes a screenshot on load — these screenshots land in the artifact S3 bucket for manual inspection.
3. **Check the response.** If the page doesn't return HTTP 200, the canary throws. AWS Synthetics records that as a failed canary run, which drives the `_Availability` metric to 0 for that URL.
4. **Measure latency.** On success, it reads the browser's Navigation Timing API (`performance.timing`) to compute `responseEnd - requestStart` as the page's load latency.
5. **Publish per-site metrics.** Both the availability outcome and the latency value are pushed to CloudWatch under the `CloudWatchSynthetics` namespace, dimensioned by `URL`, via the AWS SDK v3 `PutMetricDataCommand` — these are the exact metrics `lib/metrics.js` builds the per-URL alarms from.
6. **Publish run-level health metrics.** After the loop, the canary also reports its own total `TimeToProcess` and `MemoryUsage` for that run, each backed by its own alarm — so a canary that's degrading (e.g. from a growing URL list) is caught even if every individual site is healthy.
7. **Alarm → notify → persist.** If any alarm crosses its threshold, CloudWatch publishes to the `AlarmTopic`. The email subscriber gets a human-readable alert; the `AlarmProcessorFunction` Lambda parses the same SNS message and writes an `AlarmName` / `StateChange` / `Reason` / `Timestamp` record to the `AlarmData` DynamoDB table, defensively checking for the required environment variable and SNS records before touching the table.

## Getting Started

**Prerequisites**
- Node.js 18+
- AWS CLI, configured with credentials that can create the resources above
- AWS CDK — pinned as a dev dependency, so `npx cdk …` works after `npm install` (no global install needed)
- An AWS account [bootstrapped for CDK](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)

**Install**

```bash
git clone https://github.com/Henry-Park-Git/Cloud-Monitoring-App.git
cd Cloud-Monitoring-App
npm install
```

**Configure**

All environment-specific values (alarm email, S3 bucket, GitHub source) are read from environment variables or CDK context — nothing is hardcoded in source. Copy the example file and fill in your own values:

```bash
cp .env.example .env
# then edit .env  (see the file for the full list of variables)
```

| Variable | Used by | Purpose |
|---|---|---|
| `ALARM_EMAIL` | `WebCrawlerStack` | Address subscribed to SNS alarm notifications |
| `URLS_BUCKET_NAME` | stack + `fetch-s3-data.js` | S3 bucket holding the monitored-URL list |
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` | `WebCrawlerPipelineStack` | Source repo the pipeline builds from |
| `GITHUB_TOKEN_SECRET` | `WebCrawlerPipelineStack` | Name of the Secrets Manager secret holding the GitHub OAuth token |

Each value can also be passed inline as CDK context, e.g. `cdk deploy -c alarmEmail=you@example.com`. Account and region are taken from your AWS profile (`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`). A sample `urls.json` with five public URLs is committed so the stack synthesizes out of the box; run `node fetch-s3-data.js` to replace it from your own S3 bucket.

**Test**

```bash
npm test
```

Runs the Jest suite in [`test/web-crawler.test.js`](test/web-crawler.test.js), which asserts on the synthesized CloudFormation template rather than mocking AWS.

**Deploy**

```bash
npx cdk deploy WebCrawlerStack          # canary, alarms, SNS, DynamoDB
npx cdk deploy WebCrawlerPipelineStack  # optional: self-deploying CI/CD pipeline
```

**Tear down**

```bash
npx cdk destroy WebCrawlerStack
```

**Other useful commands**

| Command | Purpose |
|---|---|
| `npx cdk diff` | Compare the deployed stack against local changes |
| `npx cdk synth` | Emit the synthesized CloudFormation template |
| `node fetch-s3-data.js` | Refresh `urls.json` from S3 |

## Notable Engineering Decisions / Challenges

- **Scaling alarms with the URL list, not against it.** Hardcoding one alarm pair per site would mean editing the stack every time a site is added or removed. Deriving `this.urlNames` from `urls.json` and looping alarm creation over it means the number of monitored sites is a data change, not a code change — the trade-off is that the stack's resource count (and CloudFormation deploy time) grows with the URL list, which is worth watching as it scales.
- **Decoupling "what to monitor" from "how to monitor it."** Fetching `urls.json` from S3 as a pre-build step (wired into `buildspec.yml`) rather than committing target URLs directly keeps the deployable artifact reproducible from git while still letting the monitored set change independently — a common pattern for separating config from code, applied here to infrastructure rather than an application.
- **Turning ephemeral alarms into queryable history.** CloudWatch alarms are transient by nature — they tell you the *current* state, not what happened last week. Subscribing a Lambda to the same SNS topic that emails a human, and having it write structured records to DynamoDB, turns every state change into a queryable audit trail without touching the alarm or canary definitions.
- **Testing infrastructure definitions, not just application logic.** The Jest suite doesn't unit test business logic — the project barely has any — it asserts that `cdk synth` actually produces the resources the design calls for (correct bucket naming pattern, canary schedule and runtime, table keys, Lambda runtime, SNS topic). That test suite is wired into `buildspec.yml`'s `pre_build` phase, so a broken CDK construct fails the pipeline before a CloudFormation deploy is even attempted.
- **Separating "can run the pipeline" from "can deploy to production."** Rather than giving the CodePipeline's own role permission to update CloudFormation stacks directly, `web-crawler-pipeline-stack.js` creates a distinct `DeploymentRole` and wires an explicit `sts:AssumeRole` trust policy scoped to the pipeline role. It's more setup than a single admin role, but it keeps the blast radius of a compromised pipeline role limited to *triggering* a deploy, not *performing* one.
- **No environment-specific values baked into source.** The alarm recipient, S3 bucket, and GitHub source are all read from environment variables or CDK context (documented in [`.env.example`](.env.example)), while account and region come from the deploying CDK environment rather than being hardcoded. This keeps the repository safe to open-source and lets the same code deploy into any account without edits — configuration is kept separate from code. IAM policies are scoped the same way: the canary gets only the specific S3 actions it needs (not `s3:*`), and resource ARNs resolve to the deploying account rather than a fixed account ID.

## Contributors

Built collaboratively across several branches and pull requests by:

- [Henry Park](https://github.com/Henry-Park-Git) (Henry-Park-Git)
- Raman Mor
- Preety Nagpal
- Tay Nguyen

## License

MIT — see [LICENSE](LICENSE).
