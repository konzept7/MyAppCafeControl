#!/bin/bash

# get current time from ntp before doing anything

if [ -e "./.env" ]; then
  echo ".env file already exists. If you want the script to run, you have to delete it."
fi

read -p "Enter name for new thing: " thingName
read -p "Enter type of new thing [server, gate, cam, display] : " thingType

read -p "Enter AWS AccessKey : " accessKey
read -p "Enter AWS SecretKey : " secretKey


isValidThing=0
if [ "$thingType" -eq "server" ]; then
  isValidThing=1
  echo "Registering a new thing as $thingType"
  read -p "Enter hardware version [V1]: " hardwareVersion
  read -p "Enter AWS region [eu-central-1, us-east-1]: " region
  read -p "Enter the default language [de, en, es]: " language
  echo "REGION=$region" >> .env
  echo "TYPE=$thingType" >> .env
  echo "THINGNAME=$thingName" >> .env
fi

# ********************************************
# *** REGISTER THING
# ********************************************

# get a new certificate
echo "Creating keys and certificates"
cd ~/srv/MyAppCafeControl
aws iot create-keys-and-certificate --region $region --set-as-active --certificate-pem-outfile me.cert.pem --public-key-outfile me.public.key --private-key-outfile me.private.key > ~/awsresponse.json

certArn=$(`cat ~/awsresponse.json | jq '.certificateArn'`)
aws s3 cp me.public.key s3://token.myapp.cafe/$thingName.public.key
echo "Get root certificates"
sudo wget -O /etc/ssl/certs/root-CA.crt https://www.amazontrust.com/repository/AmazonRootCA1.pem
# attach policy
echo "Attaching policy"
aws iot attach-policy --region $region --target $certArn --policy-name TutorialThing-Policy
aws iot attach-policy --region $region --target $certArn --policy-name AssumeRoleWithCertificate

# new thing
echo "Creating new thing"
aws iot create-thing --region $region --thing-name $thingName --thing-type-name $thingType --attribute-payload "{\"attributes\": {\"HardwareVersion\":\"v0.1\", \"Language\": \"de\", \"Region\": \"$region\"}}"

# cert atttachen an thing
echo "Attaching principal to thing"
aws iot attach-thing-principal --region $region --thing-name $thingName --principal $certArn

# add thing to group
echo "Adding thing to thing-group"
aws iot add-thing-to-thing-group --region $region --thing-group-name MAC_Server_Debug --thing-name $thingName

# create role alias
echo "creating role alias"
aws iot create-role-alias --region $region --role-arn arn:aws:iam::311842024294:role/iot-update-role --role-alias $thingName-iot-update-role-alias --credential-duration-seconds 3600


# ********************************************
# *** PULL PROGRAM
# ********************************************