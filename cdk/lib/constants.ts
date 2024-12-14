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
