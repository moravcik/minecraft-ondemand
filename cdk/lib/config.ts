import { Port } from 'aws-cdk-lib/aws-ec2';
import { Protocol } from 'aws-cdk-lib/aws-ecs';
import * as dotenv from 'dotenv';
import * as execa from 'execa';
import * as path from 'path';
import { MinecraftEditionConfig, MinecraftImageEnv, StackConfig } from './config-types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const stringAsBoolean = (str?: string): boolean =>
  Boolean(str === 'true');

export const isDockerInstalled = (): boolean => {
  try {
    execa.sync('docker', ['version']);
    return true;
  } catch (e) {
    return false;
  }
};

export const getMinecraftServerConfig = (edition: StackConfig['minecraftEdition']): MinecraftEditionConfig => {
  const javaConfig = {
    image: constants.JAVA_EDITION_DOCKER_IMAGE,
    port: 25565,
    protocol: Protocol.TCP,
    ingressRulePort: Port.tcp(25565),
  };
  const bedrockConfig = {
    image: constants.BEDROCK_EDITION_DOCKER_IMAGE,
    port: 19132,
    protocol: Protocol.UDP,
    ingressRulePort: Port.udp(19132),
  };
  return edition === 'java' ? javaConfig : bedrockConfig;
};

const resolveMinecraftEnvVars = (json = ''): MinecraftImageEnv => {
  const defaults = { EULA: 'TRUE' };
  try {
    return { ...defaults, ...JSON.parse(json) };
  } catch (e) {
    console.error('Unable to resolve .env value for MINECRAFT_IMAGE_ENV_VARS_JSON. Defaults will be used');
    return defaults;
  }
};

export const resolveConfig = (): StackConfig => ({
  domainName: process.env.DOMAIN_NAME || '',
  subdomainPart: process.env.SUBDOMAIN_PART || 'minecraft',
  serverRegion: process.env.SERVER_REGION || 'us-east-1',
  minecraftEdition:
    process.env.MINECRAFT_EDITION === 'bedrock' ? 'bedrock' : 'java',
  shutdownMinutes: process.env.SHUTDOWN_MINUTES || '20',
  startupMinutes: process.env.STARTUP_MINUTES || '10',
  useFargateSpot: stringAsBoolean(process.env.USE_FARGATE_SPOT) || false,
  taskCpu: +(process.env.TASK_CPU || 1024),
  taskMemory: +(process.env.TASK_MEMORY || 2048),
  vpcId: process.env.VPC_ID || '',
  minecraftImageEnv: resolveMinecraftEnvVars(
    process.env.MINECRAFT_IMAGE_ENV_VARS_JSON
  ),
  snsEmailAddress: process.env.SNS_EMAIL_ADDRESS || '',
  twilio: {
    phoneFrom: process.env.TWILIO_PHONE_FROM || '',
    phoneTo: process.env.TWILIO_PHONE_TO || '',
    accountId: process.env.TWILIO_ACCOUNT_ID || '',
    authCode: process.env.TWILIO_AUTH_CODE || '',
  },
  debug: stringAsBoolean(process.env.DEBUG) || false,
});

export const constants = {
  CLUSTER_NAME: 'minecraft',
  SERVICE_NAME: 'minecraft-server',
  MC_SERVER_CONTAINER_NAME: 'minecraft-server',
  WATCHDOG_SERVER_CONTAINER_NAME: 'minecraft-ecsfargate-watchdog',
  /**
   * Because we are relying on Route 53+CloudWatch to invoke the Lambda function,
   * it _must_ reside in the N. Virginia (us-east-1) region.
   */
  DOMAIN_STACK_REGION: 'us-east-1',
  ECS_VOLUME_NAME: 'data',
  JAVA_EDITION_DOCKER_IMAGE: 'itzg/minecraft-server',
  BEDROCK_EDITION_DOCKER_IMAGE: 'itzg/minecraft-bedrock-server',
}
