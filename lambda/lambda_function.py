import os
import boto3

REGION = os.environ.get('REGION', 'us-west-2')
CLUSTER = os.environ.get('CLUSTER', 'minecraft')
SERVICE = os.environ.get('SERVICE', 'minecraft-server')

def lambda_handler(event, context):
    ecs = boto3.client('ecs', region_name=REGION)
    response = ecs.describe_services(cluster=CLUSTER, services=[SERVICE])
    desired = response["services"][0]["desiredCount"]
    if desired == 0:
        ecs.update_service(cluster=CLUSTER, service=SERVICE, desiredCount=1)
        print("Updated desiredCount to 1")
    else:
        print("desiredCount already at 1")
