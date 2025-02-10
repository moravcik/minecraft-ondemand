/**
 * Usage: npx ts-node ecs-update.ts [command]
 *
 *  Available commands:
 *  - up: set desired count to 1 for all services
 *  - down: set desired count to 0 for all services
 *  - redeploy: force new deployment for all services
 *
 * Environment variables:
 * - AWS_PROFILE - name of the AWS CLI profile to use
 * - ENV - environment name
 *
 * Note: It takes several minutes for the ECS service to update
 */
import { ECSClient, ListServicesCommand, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import * as assert from 'node:assert';
import { resolveStackConfig } from './cdk/lib/config';

const config = resolveStackConfig();

const command = process.argv[2];
assert(['up', 'down', 'redeploy'].includes(command), 'Invalid command, use: up, down, or redeploy');

const ecsClient = new ECSClient({ region: config.serverRegion });

ecsClient.send(new ListServicesCommand({ cluster: config.clusterName, maxResults: 100 })).then(
  async data => {
    const commandInputs = (data.serviceArns ?? [])
      .map(serviceArn => serviceArn.split('/').slice(-1)[0])
      .filter(service => service === config.serviceName)
      .map(service => (
        {
          cluster: config.clusterName,
          service,
          ...(command === 'up' ? { desiredCount: 1 } : {}),
          ...(command === 'down' ? { desiredCount: 0 } : {}),
          ...(command === 'redeploy' ? { forceNewDeployment: true } : {})
        }
      ));
    console.log('Sending ECS update commands:', commandInputs);
    await Promise.all(
      commandInputs.map(input => ecsClient.send(new UpdateServiceCommand(input)))
    );
  },
  error => console.error(error)
);
