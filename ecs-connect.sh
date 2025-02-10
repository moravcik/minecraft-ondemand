#!/bin/bash

CLUSTER=$1-minecraft-cluster
SERVICE=$1-minecraft-server

task_id=$(aws ecs list-tasks --region eu-west-1 --cluster $CLUSTER --service-name $SERVICE --desired-status RUNNING --output text --query 'taskArns[0]')

echo "Connecting to service: $SERVICE, task: $task_id"
aws ecs execute-command  \
    --region eu-west-1 \
    --cluster $CLUSTER \
    --task $task_id \
    --container $SERVICE \
    --command "/bin/sh" \
    --interactive