#!/bin/bash

echo "****************************************************************"
echo "*** This script creates a new role that can be used for getting"
echo "*** temporary credentials from IoT certificates. Please be sure"
echo "*** that all files in the /policies directory are set according"
echo "*** to the permissions you need."
echo "****************************************************************"

echo "Are you sure? y/n"
read -r sure

if [[ "$sure" != "y" ]]; 
  then return
fi

echo ""
echo "****************************************************************"
echo "*** At the current stage, this is just an example of what could"
echo "*** be done with a script like that. Below commands are in just"
echo "*** the right order to work properly, but you certainly have to"
echo "*** alter the policy documents in the /policies directory."
echo "****************************************************************"
echo ""

echo ""
echo "****************************************************************"
echo "*** If you wanted to use parts of the following example, escape"
echo "*** all policy documents or use the file:// helper. "
echo "****************************************************************"
echo ""

echo "How should the new role be named?"
read -r roleName
echo "What is your AWS user name?"
read -r userName

echo ""
echo "*** Create the role that grants access to temporary credentials. No need to alter it."
echo "aws iam create-role --role-name $roleName --assume-role-policy-document {\"Version\":\"2012-10-17\",\"Statement\":{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"credentials.iot.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}}"

echo ""
echo "*** Create the actual policy - the policy with the permissions you later need. Alter the policy document!"
echo "aws iam create-policy --policy-name accesspolicyfor-$roleName --policy-document {\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:ListAllMyBuckets\",\"Resource\":\"*\"},{\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\",\"s3:GetBucketLocation\"],\"Resource\":\"arn:aws:s3:::awsexamplebucket1\"},{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:PutObjectAcl\",\"s3:GetObject\",\"s3:GetObjectAcl\",\"s3:DeleteObject\"],\"Resource\":\"arn:aws:s3:::erp.boxes.myapp.cafe\/*\"}]}"

echo ""
echo "*** Attach the new policy to the new role."
echo "aws iam attach-role-policy --role-name $roleName --policy-arn arn:aws:iam::311842024294:policy/accesspolicyfor-$roleName"

echo ""
echo "*** Create a policy that allows passing of the role."
echo "aws iam create-policy --policy-name passrole-for-$roleName --policy-document {\"Version\":\"2012-10-17\",\"Statement\":{\"Effect\":\"Allow\",\"Action\":[\"iam:GetRole\",\"iam:PassRole\"],\"Resource\":\"arn:aws:iam::311842024294:role\/$roleName\"}}"

echo ""
echo "*** Attach the role to your own user, useful in testing."
echo "aws iam attach-user-policy --policy-arn arn:aws:iam::311842024294:policy/passrole-for-$roleName --user-name $userName"

echo ""
echo "*** Create a policy that can be used in AWS IoT"
echo "aws iot create-policy --policy-name $roleName-policy --policy-document {\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"iot:AssumeRoleWithCertificate\",\"Resource\":\"arn:aws:iot:eu-central-1:311842024294:rolealias\/\${iot:Connection.Thing.ThingName}-$roleName-alias\"}]}"

echo ""
echo "*** Create a role alias."
echo "aws iot create-role-alias --role-alias $roleName-alias --role-arn arn:aws:iam::311842024294:role/$roleName --credential-duration-seconds 3600"
echo ""

echo "****************************************************************"
echo "*** Don't forget to attach the new role to any certificate that"
echo "*** needs this role to function properly."
echo "****************************************************************"

echo ""
echo "aws iot attach-policy --policy-name $roleName-policy --target <certificate-arn>"

read -r