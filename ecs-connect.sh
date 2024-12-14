#!/bin/bash

CLUSTER=minecraft

task_id=$(aws ecs list-tasks --region eu-west-1 --cluster $CLUSTER --service-name $1 --desired-status RUNNING --output text --query 'taskArns[0]')

echo "Connecting to service: $1, task: $task_id"
aws ecs execute-command  \
    --region eu-west-1 \
    --cluster $CLUSTER \
    --task $task_id \
    --container $1 \
    --command "/bin/sh" \
    --interactive