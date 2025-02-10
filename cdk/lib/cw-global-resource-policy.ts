import { Duration } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  AwsSdkCall,
  PhysicalResourceId
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

interface CWGlobalResourcePolicyProps {
  statements: PolicyStatement[];
  policyName: string;
}

/**
 * Cloudwatch logs have global resource policies that allow EventBridge to
 * write logs to a given Cloudwatch Log group. This is currently not
 * implemented with CDK, so we use a Custom Resource here.
 * See https://github.com/aws/aws-cdk/issues/5343
 */
export class CWGlobalResourcePolicy extends AwsCustomResource {
  constructor(scope: Construct, name: string, props: CWGlobalResourcePolicyProps) {
    const { statements, policyName } = props;

    const putResourcePolicy: AwsSdkCall = {
      service: 'CloudWatchLogs',
      action: 'putResourcePolicy',
      parameters: {
        policyName,
        // PolicyDocument must be provided as a string, so we can't use the PolicyDocument provisions or other CDK niceties here.
        policyDocument: JSON.stringify({ Version: '2012-10-17', Statement: statements }),
      },
      physicalResourceId: PhysicalResourceId.of(policyName),
    };

    const deleteResourcePolicy: AwsSdkCall = {
      service: 'CloudWatchLogs',
      action: 'deleteResourcePolicy',
      parameters: { policyName },
    };

    super(scope, name, {
      onUpdate: putResourcePolicy,
      onCreate: putResourcePolicy,
      onDelete: deleteResourcePolicy,
      timeout: Duration.minutes(2),
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
      logRetention: RetentionDays.THREE_DAYS,
    });
  }
}
