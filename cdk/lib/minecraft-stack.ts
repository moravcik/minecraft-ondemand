import { Stack, StackProps, RemovalPolicy, Arn, ArnFormat } from 'aws-cdk-lib';
import { Peer, SecurityGroup, Vpc } from 'aws-cdk-lib/aws-ec2';
import {
  AwsLogDriver,
  Cluster,
  ContainerDefinition,
  ContainerImage,
  FargateService,
  FargateTaskDefinition
} from 'aws-cdk-lib/aws-ecs';
import { AccessPoint, FileSystem } from 'aws-cdk-lib/aws-efs';
import { Effect, Policy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Subscription, SubscriptionProtocol, Topic } from 'aws-cdk-lib/aws-sns';
import * as path from 'path';
import { Construct } from 'constructs';
import { constants, getMinecraftServerConfig, isDockerInstalled } from './config';
import { StackConfig } from './config-types';
import { DomainStackExports } from './domain-stack';

interface MinecraftStackProps extends StackProps {
  config: Readonly<StackConfig>;
  domain: DomainStackExports;
}

export class MinecraftStack extends Stack {
  constructor(scope: Construct, id: string, props: MinecraftStackProps) {
    super(scope, id, props);

    const { config, domain } = props;

    const vpc = config.vpcId
      ? Vpc.fromLookup(this, 'Vpc', { vpcId: config.vpcId })
      : new Vpc(this, 'Vpc', { maxAzs: 3, natGateways: 0 });

    const fileSystem = new FileSystem(this, 'FileSystem', {
      vpc,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    const accessPoint = new AccessPoint(this, 'AccessPoint', {
      fileSystem,
      path: '/minecraft',
      posixUser: { uid: '1000', gid: '1000' },
      createAcl: { ownerGid: '1000', ownerUid: '1000', permissions: '0755' },
    });

    const efsReadWriteDataPolicy = new Policy(this, 'DataRWPolicy', {
      statements: [
        new PolicyStatement({
          sid: 'AllowReadWriteOnEFS',
          effect: Effect.ALLOW,
          actions: [
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:DescribeFileSystems',
          ],
          resources: [fileSystem.fileSystemArn],
          conditions: {
            StringEquals: { 'elasticfilesystem:AccessPointArn': accessPoint.accessPointArn },
          },
        }),
      ],
    });

    const ecsTaskRole = new Role(this, 'TaskRole', {
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Minecraft ECS task role',
    });

    efsReadWriteDataPolicy.attachToRole(ecsTaskRole);

    const cluster = new Cluster(this, 'Cluster', {
      clusterName: constants.CLUSTER_NAME,
      vpc,
      containerInsights: true, // TODO: Add config for container insights
      enableFargateCapacityProviders: true,
    });

    const taskDefinition = new FargateTaskDefinition(this, 'TaskDefinition', {
      taskRole: ecsTaskRole,
      memoryLimitMiB: config.taskMemory,
      cpu: config.taskCpu,
      volumes: [{
        name: constants.ECS_VOLUME_NAME,
        efsVolumeConfiguration: {
          fileSystemId: fileSystem.fileSystemId,
          transitEncryption: 'ENABLED',
          authorizationConfig: { accessPointId: accessPoint.accessPointId, iam: 'ENABLED' },
        },
      }],
    });

    const minecraftServerConfig = getMinecraftServerConfig(config.minecraftEdition);

    const minecraftServerContainer = new ContainerDefinition(this, 'ServerContainer', {
      containerName: constants.MC_SERVER_CONTAINER_NAME,
      image: ContainerImage.fromRegistry(minecraftServerConfig.image),
      portMappings: [{
        containerPort: minecraftServerConfig.port,
        hostPort: minecraftServerConfig.port,
        protocol: minecraftServerConfig.protocol,
      }],
      environment: config.minecraftImageEnv,
      essential: true,
      taskDefinition,
      logging: config.debug
        ? new AwsLogDriver({
            logRetention: RetentionDays.THREE_DAYS,
            streamPrefix: constants.MC_SERVER_CONTAINER_NAME,
          })
        : undefined,
    });

    minecraftServerContainer.addMountPoints({
      containerPath: '/data',
      sourceVolume: constants.ECS_VOLUME_NAME,
      readOnly: false,
    });

    const serviceSecurityGroup = new SecurityGroup(this, 'ServiceSecurityGroup', {
      vpc,
      description: 'Security group for Minecraft on-demand',
    });
    serviceSecurityGroup.addIngressRule(Peer.anyIpv4(), minecraftServerConfig.ingressRulePort);

    const minecraftServerService = new FargateService(this, 'FargateService', {
      cluster,
      capacityProviderStrategies: [{
        capacityProvider: config.useFargateSpot ? 'FARGATE_SPOT' : 'FARGATE',
        weight: 1,
        base: 1,
      }],
      enableExecuteCommand: true,
      taskDefinition,
      serviceName: constants.SERVICE_NAME,
      desiredCount: 0,
      assignPublicIp: true,
      securityGroups: [serviceSecurityGroup],
    });

    /* Allow access to EFS from Fargate service security group */
    fileSystem.connections.allowDefaultPortFrom(minecraftServerService.connections);

    let snsTopicArn = '';
    // Create SNS Topic if SNS_EMAIL is provided
    if (config.snsEmailAddress) {
      const snsTopic = new Topic(this, 'ServerSnsTopic', { displayName: 'Minecraft Server Notifications' });
      snsTopic.grantPublish(ecsTaskRole);
      new Subscription(this, 'EmailSubscription', {
        protocol: SubscriptionProtocol.EMAIL,
        topic: snsTopic,
        endpoint: config.snsEmailAddress,
      });
      snsTopicArn = snsTopic.topicArn;
    }

    new ContainerDefinition(this, 'WatchDogContainer', {
      containerName: constants.WATCHDOG_SERVER_CONTAINER_NAME,
      image: isDockerInstalled()
        ? ContainerImage.fromAsset(path.resolve(__dirname, '../../minecraft-ecsfargate-watchdog/'))
        : ContainerImage.fromRegistry('doctorray/minecraft-ecsfargate-watchdog'),
      essential: true,
      taskDefinition,
      environment: {
        CLUSTER: constants.CLUSTER_NAME,
        SERVICE: constants.SERVICE_NAME,
        DNSZONE: domain.subdomainHostedZoneId,
        SERVERNAME: `${config.subdomainPart}.${config.domainName}`,
        SNSTOPIC: snsTopicArn,
        TWILIOFROM: config.twilio.phoneFrom,
        TWILIOTO: config.twilio.phoneTo,
        TWILIOAID: config.twilio.accountId,
        TWILIOAUTH: config.twilio.authCode,
        STARTUPMIN: config.startupMinutes,
        SHUTDOWNMIN: config.shutdownMinutes,
      },
      logging: config.debug
        ? new AwsLogDriver({
            logRetention: RetentionDays.THREE_DAYS,
            streamPrefix: constants.WATCHDOG_SERVER_CONTAINER_NAME,
          })
        : undefined,
    });

    const serviceControlPolicy = new Policy(this, 'ServiceControlPolicy', {
      statements: [
        new PolicyStatement({
          sid: 'AllowAllOnServiceAndTask',
          effect: Effect.ALLOW,
          actions: ['ecs:*'],
          resources: [
            minecraftServerService.serviceArn,
            /* arn:aws:ecs:<region>:<account_number>:task/minecraft/* */
            Arn.format(
              {
                service: 'ecs',
                resource: 'task',
                resourceName: `${constants.CLUSTER_NAME}/*`,
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
              },
              this
            ),
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ec2:DescribeNetworkInterfaces'],
          resources: ['*'],
        }),
      ],
    });

    serviceControlPolicy.attachToRole(ecsTaskRole);

    const launcherLambdaRole = Role.fromRoleArn(this, 'LauncherLambdaRole', domain.launcherLambdaRoleArn);
    serviceControlPolicy.attachToRole(launcherLambdaRole);

    /**
     * This policy gives permission to our ECS task to update the A record
     * associated with our minecraft server. Retrieve the hosted zone identifier
     * from Route 53 and place it in the Resource line within this policy.
     */
    const iamRoute53Policy = new Policy(this, 'IamRoute53Policy', {
      statements: [
        new PolicyStatement({
          sid: 'AllowEditRecordSets',
          effect: Effect.ALLOW,
          actions: [
            'route53:GetHostedZone',
            'route53:ChangeResourceRecordSets',
            'route53:ListResourceRecordSets',
          ],
          resources: [`arn:aws:route53:::hostedzone/${domain.subdomainHostedZoneId}`],
        }),
      ],
    });
    iamRoute53Policy.attachToRole(ecsTaskRole);
  }
}
