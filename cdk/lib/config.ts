import { Port } from 'aws-cdk-lib/aws-ec2';
import { Protocol } from 'aws-cdk-lib/aws-ecs';
import * as dotenv from 'dotenv';
import * as execa from 'execa';
import { resolve } from 'path';
import { MinecraftEditionConfig, MinecraftImageEnv, StackConfig } from './config-types';

dotenv.config({ path: resolve(__dirname, `../${process.env.ENV}.env`) });

export const resolveStackConfig = (): StackConfig => {
  const domainName = process.env.DOMAIN_NAME!;
  const subdomainPart = process.env.SUBDOMAIN_PART || 'minecraft';
  const resourcePrefix =
    `${subdomainPart}.${domainName}`.replace(/\./g, '-')
    + (subdomainPart === 'minecraft' ? '' : '-minecraft');
  return {
    domainName,
    subdomainPart,
    resourcePrefix,
    serverRegion: process.env.SERVER_REGION || 'us-east-1',
    clusterName: `${resourcePrefix}-cluster`,
    serviceName: `${resourcePrefix}-server`,
    minecraftEdition: process.env.MINECRAFT_EDITION === 'bedrock' ? 'bedrock' : 'java',
    shutdownMinutes: process.env.SHUTDOWN_MINUTES || '20',
    startupMinutes: process.env.STARTUP_MINUTES || '10',
    useFargateSpot: stringAsBoolean(process.env.USE_FARGATE_SPOT) || false,
    taskCpu: +(process.env.TASK_CPU || 1024),
    taskMemory: +(process.env.TASK_MEMORY || 2048),
    vpcId: process.env.VPC_ID || '',
    minecraftImageEnv: resolveMinecraftEnvVars(process.env.MINECRAFT_IMAGE_ENV_VARS_JSON),
    snsEmailAddress: process.env.SNS_EMAIL_ADDRESS || '',
    twilio: {
      phoneFrom: process.env.TWILIO_PHONE_FROM || '',
      phoneTo: process.env.TWILIO_PHONE_TO || '',
      accountId: process.env.TWILIO_ACCOUNT_ID || '',
      authCode: process.env.TWILIO_AUTH_CODE || '',
    },
    debug: stringAsBoolean(process.env.DEBUG) || false,
    bastionHost: stringAsBoolean(process.env.BASTION_HOST) || false,
  }
};

export const getMinecraftServerConfig = (edition: StackConfig['minecraftEdition']): MinecraftEditionConfig =>
  edition === 'java'
    ? {
      image: 'itzg/minecraft-server',
      port: 25565,
      protocol: Protocol.TCP,
      ingressRulePorts: [Port.tcp(25565), /* Port.udp(19132) enable for geyser plugin */],
    }
    : {
      image: 'itzg/minecraft-bedrock-server',
      port: 19132,
      protocol: Protocol.UDP,
      ingressRulePorts: [Port.udp(19132)],
    };

export const isDockerInstalled = (): boolean => {
  try {
    execa.sync('docker', ['version']);
    return true;
  } catch (e) {
    return false;
  }
};

const stringAsBoolean = (str?: string): boolean => Boolean(str === 'true');

const resolveMinecraftEnvVars = (json = ''): MinecraftImageEnv => {
  const defaults = { EULA: 'TRUE' };
  try {
    return { ...defaults, ...JSON.parse(json) };
  } catch (e) {
    console.error('Unable to resolve .env value for MINECRAFT_IMAGE_ENV_VARS_JSON. Defaults will be used');
    return defaults;
  }
};
