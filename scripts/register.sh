#!/bin/bash

# get current time from ntp before doing anything

if [[ -e "./.env" ]]; then
  echo ".env file already exists. If you want the script to run, you have to delete it."
  exit 1
fi

echo "****************************************************************"
echo "*** This script needs temporary session tokens for AWS access. "
echo "*** Please prepare by calling 'aws sts get-session-token'"
echo "*** from *your* host machine"
echo "****************************************************************"


read -p "Enter the thing name : " thingName
read -p "Enter type of new thing [Server, gate, cam, display] : " thingType
read -p "Enter the 2-digit country code where the box will be located [de, us] : " thingGroup

# TODO: check type

read -p "Enter AWS AccessKey : " accessKey
read -p "Enter AWS SecretKey : " secretKey
read -p "Enter AWS Session Token : " sessionToken
export AWS_SECRET_ACCESS_KEY=$secretKey
export AWS_ACCESS_KEY_ID=$accessKey
export AWS_SESSION_TOKEN=$sessionToken

# TODO: export keys/token

userpool=eu-central-1_7iLxD02o9
clientid=41bsovn23a01gv0ogt1ag2ih2p

isValidThing=0
if [[ "$thingType" != "Server" ]]; then
  return 7
fi
echo "Registering a new thing as $thingType"
read -p "Enter hardware version [V1]: " hardwareVersion
read -p "Enter AWS region [eu-central-1, us-east-1]: " region
read -p "Enter the default language [de, en, es]: " language
echo "REGION=$region" >> /home/pi/srv/MyAppCafeControl/.env
echo "TYPE=$thingType" >> /home/pi/srv/MyAppCafeControl/.env
echo "THINGNAME=$thingName" >> /home/pi/srv/MyAppCafeControl/.env
echo "VUE_APP_SERVER_IP=192.168.55.17" >> /home/pi/srv/MyAppCafeControl/.env
echo "BOXID=$thingName" >> /home/pi/srv/MyAppCafeControl/.env
echo "AWS_REGION=$region" >> /home/pi/srv/MyAppCafeControl/.env
echo "EVENTSTABLE=boxevents" >> /home/pi/srv/MyAppCafeControl/.env
echo "DOC_BUCKET=doc.myapp.cafe" >> /home/pi/srv/MyAppCafeControl/.env
echo "MYAPPCAFESERVER_PATH=/home/pi/srv/MyAppCafeControl/" >> /home/pi/srv/MyAppCafeControl/.env
echo "LOCALPROXY_PATH=/home/pi/aws-iot-securetunneling-localproxy/build/bin" >> /home/pi/srv/MyAppCafeControl/.env
echo "VUE_APP_PLU_PORT=8000" >> /home/pi/srv/MyAppCafeControl/.env
echo "VUE_APP_MAINSERVER_PORT=5002" >> /home/pi/srv/MyAppCafeControl/.env
echo "VUE_APP_LANGUAGE=$language" >> /home/pi/srv/MyAppCafeControl/.env
echo "COGNITO_POOL=$userpool" >> /home/pi/srv/MyAppCafeControl/.env
echo "COGNITO_CLIENT=$clientid" >> /home/pi/srv/MyAppCafeControl/.env


# ********************************************
# *** REGISTER THING
# ********************************************

echo "installing packages for MyAppCafeControl"
cd /home/pi/srv/MyAppCafeControl
npm install
npm run build

# get a new certificate
echo "Creating keys and certificates"
cd ~/srv/MyAppCafeControl
aws iot create-keys-and-certificate --region $region --set-as-active --certificate-pem-outfile me.cert.pem --public-key-outfile me.public.key --private-key-outfile me.private.key > ~/awsresponse.json

certArn=$(cat ~/awsresponse.json | jq -r '.certificateArn')

echo "created certificate with ARN $certArn in region $region"

aws s3 cp me.public.key s3://token.myapp.cafe/$thingName.public.key
echo "Get root certificates"
sudo wget -O root-CA.crt https://www.amazontrust.com/repository/AmazonRootCA1.pem

echo "Converting pem files to pfx"
openssl pkcs12 -export -in me.cert.pem -inkey me.private.key -out me.cert.pfx -certfile root-CA.crt -passout pass:

# attach policy
echo "Attaching policies"
aws iot attach-policy --region $region --target $certArn --policy-name TutorialThing-Policy
aws iot attach-policy --region $region --target $certArn --policy-name AssumeRoleWithCertificate
aws iot attach-policy --region $region --target $certArn --policy-name box-server-policy

# new thing
echo "Creating new thing"
aws iot create-thing --region $region --thing-name $thingName --thing-type-name $thingType --attribute-payload "{\"attributes\": {\"HardwareVersion\":\"v0.1\", \"Language\": \"de\", \"Region\": \"$region\"}}"

# cert atttachen an thing
echo "Attaching principal to thing"
aws iot attach-thing-principal --region $region --thing-name $thingName --principal $certArn

# add thing to group
echo "Adding thing to thing-groups"
aws iot add-thing-to-thing-group --region $region --thing-group-name $thingGroup --thing-name $thingName

# create role alias
echo "creating role aliases"
aws iot create-role-alias --region eu-central-1 --role-arn arn:aws:iam::311842024294:role/iot-update-role --role-alias $thingName-iot-update-role-alias --credential-duration-seconds 3600
aws iot create-role-alias --region eu-central-1 --role-arn arn:aws:iam::311842024294:role/iot-box-role --role-alias $thingName-iot-box-role-alias --credential-duration-seconds 43200

echo "downloading current solution"
aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 311842024294.dkr.ecr.eu-central-1.amazonaws.com
docker-compose pull

echo "creating cognito user"
aws iot add-thing-to-thing-group --region $region --thing-group-name $thingGroup --thing-name $thingName #

username=$thingName@myapp.cafe
tempPass=$(openssl rand -base64 16)
password=$(openssl rand -base64 16)


echo "box cognito password is $password. please check if it set in env file"
echo "COGNITO_PASSWORD=$password" >> /home/pi/srv/MyAppCafeControl/.env

aws cognito-idp admin-create-user --user-pool-id $userpool --region $region --username $thingName@myapp.cafe --user-attributes Name=email,Value=$username Name=custom:hierarchyId,Value=el#mac#d$thingGroup#$thingName --desired-delivery-mediums EMAIL --temporary-password $tempPass

session=$(aws cognito-idp admin-initiate-auth --user-pool-id $userpool --region $region --client-id $clientid --auth-flow ADMIN_NO_SRP_AUTH --auth-parameters USERNAME=$username,PASSWORD=$tempPass | jq -r ".Session")
echo "session token is $session"
aws cognito-idp admin-respond-to-auth-challenge --region $region --user-pool-id $userpool --client-id $clientid --challenge-name NEW_PASSWORD_REQUIRED --challenge-responses NEW_PASSWORD=$password,USERNAME=$username --session $session
aws cognito-idp admin-add-user-to-group --user-pool-id $userpool --region $region --username $username --group-name box
aws cognito-idp admin-add-user-to-group --user-pool-id $userpool --region $region --username $username --group-name wawi
aws cognito-idp admin-add-user-to-group --user-pool-id $userpool --region $region --username $username --group-name admin


echo "adding public key to authorized keys"
# Define the filename
mkdir -p /home/pi/ssh/
touch /home/pi/.ssh/authorized_keys
publicKey=$(aws s3 cp s3://iot.myapp.cafe/keys/default-public-ssh-key/id_rsa.pub -)
echo $publicKey >> /home/pi/.ssh/authorized_keys

echo ""
echo "# ********************************************"
echo "# *** Registration complete *** "
echo "# *** registered $thingName as $thingType in $region *** "
echo "# *** Please check output for errors! *** "
echo "# *** Downloaded current solution *** "
echo "# ********************************************"
echo "  "