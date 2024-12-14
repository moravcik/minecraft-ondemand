import { Stack, StackProps, Duration, RemovalPolicy, Arn, ArnFormat } from 'aws-cdk-lib';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { FilterPattern, LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { LambdaDestination } from 'aws-cdk-lib/aws-logs-destinations';
import { ARecord, HostedZone, NsRecord } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import * as path from 'path';
import { constants } from './constants';
import { CWGlobalResourcePolicy } from './cw-global-resource-policy';
import { StackConfig } from './types';

interface DomainStackProps extends StackProps {
  config: Readonly<StackConfig>;
}

export interface DomainStackExports {
  launcherLambdaRoleArn: string;
  subdomainHostedZoneId: string;
}

export class DomainStack extends Stack {

  public readonly  exports: DomainStackExports;

  constructor(scope: Construct, id: string, props: DomainStackProps) {
    super(scope, id, props);

    const { config } = props;

    const subdomain = `${config.subdomainPart}.${config.domainName}`;
    const subdomainNormalized = subdomain.replace(/\./g, '-');

    const queryLogGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/route53/${subdomainNormalized}`,
      retention: RetentionDays.THREE_DAYS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    /* Create policy to allow route53 to log to cloudwatch */
    const policyName = 'cw.r.route53-dns';
    const dnsWriteToCw = [
      new PolicyStatement({
        sid: 'AllowR53LogToCloudwatch',
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal('route53.amazonaws.com')],
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          Arn.format(
            {
              resource: 'log-group',
              service: 'logs',
              resourceName: '*',
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            },
            this
          ),
        ],
      }),
    ];
    const cloudwatchLogResourcePolicy = new CWGlobalResourcePolicy(
      this,
      'CloudwatchLogResourcePolicy',
      { policyName, statements: dnsWriteToCw }
    );

    const rootHostedZone = HostedZone.fromLookup(this, 'HostedZone', {
      domainName: config.domainName,
    });

    const subdomainHostedZone = new HostedZone(
      this,
      'SubdomainHostedZone',
      {
        zoneName: subdomain,
        queryLogsLogGroupArn: queryLogGroup.logGroupArn,
      }
    );

    /* Resource policy for CloudWatch Logs is needed before the zone can be created */
    subdomainHostedZone.node.addDependency(cloudwatchLogResourcePolicy);
    /* Ensure we hvae an existing hosted zone before creating our delegated zone */
    subdomainHostedZone.node.addDependency(rootHostedZone);

    const nsRecord = new NsRecord(this, 'NSRecord', {
      zone: rootHostedZone,
      values: subdomainHostedZone.hostedZoneNameServers as string[],
      recordName: subdomain,
    });

    const aRecord = new ARecord(this, 'ARecord', {
      target: {
        /**
         * The value of the record is irrelevant because it will be updated
         * every time our container launches.
         */
        values: ['192.168.1.1'],
      },
      /**
       * The low TTL is so that the DNS clients and non-authoritative DNS
       * servers won't cache the record long and you can connect quicker after
       * the IP updates.
       */
      ttl: Duration.seconds(15),
      recordName: subdomain,
      zone: subdomainHostedZone,
    });

    /* Set dependency on A record to ensure it is removed first on deletion */
    aRecord.node.addDependency(subdomainHostedZone);

    const launcherLambda = new NodejsFunction(this, 'LauncherLambda', {
      entry: path.resolve(__dirname, '../../lambda/launcher-lambda.ts'),
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      environment: {
        REGION: config.serverRegion,
        CLUSTER: constants.CLUSTER_NAME,
        SERVICE: constants.SERVICE_NAME,
      },
      logRetention: RetentionDays.THREE_DAYS, // TODO: parameterize
    });

    /**
     * Give cloudwatch permission to invoke our lambda when our subscription filter
     * picks up DNS queries.
     */
    launcherLambda.addPermission('CWPermission', {
      principal: new ServicePrincipal(
        `logs.${constants.DOMAIN_STACK_REGION}.amazonaws.com`
      ),
      action: 'lambda:InvokeFunction',
      sourceAccount: this.account,
      sourceArn: queryLogGroup.logGroupArn,
    });

    /**
     * Create our log subscription filter to catch any log events containing
     * our subdomain name and send them to our launcher lambda.
     */
    queryLogGroup.addSubscriptionFilter('SubscriptionFilter', {
      destination: new LambdaDestination(launcherLambda),
      filterPattern: FilterPattern.anyTerm(subdomain, subdomainNormalized),
    });

    this.exports = {
      subdomainHostedZoneId: subdomainHostedZone.hostedZoneId,
      launcherLambdaRoleArn: launcherLambda.role!.roleArn,
    };
  }
}
