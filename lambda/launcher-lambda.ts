import { DescribeServicesCommand, ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';

const region = process.env.REGION || 'us-west-2';
const cluster = process.env.CLUSTER || 'minecraft';
const service = process.env.SERVICE || 'minecraft-server';

const ecsClient = new ECSClient({ region });

export async function handler(event: any, context: any): Promise<void> {
  const { services } = await ecsClient.send(new DescribeServicesCommand({ cluster, services: [service] }));
  const desired = services![0].desiredCount;
  if (desired === 0) {
    await ecsClient.send(new UpdateServiceCommand({ cluster, service, desiredCount: 1 }));
    console.log('Updated desiredCount to 1');
  } else {
    console.log('desiredCount already at 1');
  }
}
