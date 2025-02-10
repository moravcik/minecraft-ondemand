import { Aws } from 'aws-cdk-lib';
import {
  BastionHostLinux,
  CloudFormationInit,
  IVpc,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData
} from 'aws-cdk-lib/aws-ec2';
import { IFileSystem } from 'aws-cdk-lib/aws-efs';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { StackConfig } from './config-types';

export interface JumpBoxProps {
  config: StackConfig;
  vpc: IVpc;
  fileSystem: IFileSystem;
}

export class BastionHost extends Construct {

  constructor(scope: Construct, id: string, { config, vpc, fileSystem }: JumpBoxProps) {
    super(scope, id);

    const securityGroup = new SecurityGroup(this, 'BastionSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description: 'Security group for bastion host',
      securityGroupName: 'BastionSecurityGroup',
    });

    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(22), 'SSH access');

    const bastionHost = new BastionHostLinux(this, 'BastionHostLinux', {
      vpc,
      securityGroup,
      subnetSelection: { subnetType: SubnetType.PUBLIC },
      init: CloudFormationInit.fromElements(),
      requireImdsv2: true
    });

    fileSystem.connections.allowDefaultPortFrom(bastionHost);

    const syncBucket = new Bucket(this, 'BastionSyncBucket');

    bastionHost.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess')
    );

    const userData = bastionHost.instance.userData;

    userDataAddEnvVars({ SYNC_BUCKET: syncBucket.bucketName }, userData);
    userDataMountEfs(
      { fileSystemId: fileSystem.fileSystemId, mountPoint: '/mnt/efs' },
      userData
    );
  }
}

function userDataMountEfs({ fileSystemId, mountPoint }: { fileSystemId: string, mountPoint: string }, userData = UserData.forLinux()): UserData {
  userData.addCommands(
    'yum check-update -y',
    'yum upgrade -y',
    'yum install -y amazon-efs-utils',
    'yum install -y nfs-utils',
    `mkdir -p ${mountPoint}`,
    `test -f "/sbin/mount.efs" && echo "${fileSystemId}:/ ${mountPoint} efs defaults,_netdev" >> /etc/fstab || echo "${fileSystemId}.efs.${Aws.REGION}.amazonaws.com:/ ${mountPoint} nfs4 nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport,_netdev 0 0" >> /etc/fstab`,
    'mount -a -t efs,nfs4 defaults'
  );
  return userData;
}

function userDataAddEnvVars(envVars: { [key: string]: string }, userData = UserData.forLinux()): UserData {
  userDataAddEnvVarsByType(envVars, 'sh', userData);
  userDataAddEnvVarsByType(envVars, 'csh', userData);
  return userData;
}

function userDataAddEnvVarsByType(envVars: { [key: string]: string }, type: 'sh' | 'csh', userData: UserData) {
  const profiledPath = `/etc/profile.d/cdk_variables.${type}`;

  const envExports = Object.keys(envVars)
    .map(key => type === 'sh'
      ? `export ${key}=\\"${envVars[key]}\\"`
      : `setenv ${key} \\"${envVars[key]}\\"`)
    .join('\\n');

  userData.addCommands(
    `touch ${profiledPath}`,
    `chmod +x ${profiledPath}`,
    `echo -e "${envExports}" > ${profiledPath}`,
  );
}
