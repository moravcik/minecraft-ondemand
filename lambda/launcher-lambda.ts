import { DescribeServicesCommand, ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { unzipSync } from 'zlib';

const region = process.env.REGION || 'us-west-2';
const cluster = process.env.CLUSTER || 'minecraft';
const service = process.env.SERVICE || 'minecraft-server';

const allowedUtcHours = JSON.parse(process.env.ALLOWED_UTC_HOURS || '[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]');

const ecsClient = new ECSClient({ region });

export async function handler(event: any, context: any): Promise<void> {
  if (event?.awslogs?.data) {
    const payload = Buffer.from(event.awslogs.data, 'base64');
    const logevents = JSON.parse(unzipSync(payload).toString()).logEvents;
    console.log('***', logevents);
  }
  const now = new Date();
  const utcHour = now.getUTCHours();
  if (!allowedUtcHours.includes(utcHour)) {
    console.log(`UTC hour ${utcHour} is not allowed to start the server`);
    return;
  }
  const { services } = await ecsClient.send(new DescribeServicesCommand({ cluster, services: [service] }));
  const desired = services![0].desiredCount;
  if (desired === 0) {
    await ecsClient.send(new UpdateServiceCommand({ cluster, service, desiredCount: 1 }));
    console.log('Updated desiredCount to 1');
  } else {
    console.log('desiredCount already at 1');
  }
}
