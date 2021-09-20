#!/bin/bash

# get current time from ntp before doing anything

if [[ -e "./.env" ]]; then
  echo ".env file already exists. If you want the script to run, you have to delete it."
  exit 1
fi

read -p "Enter name for new thing: " thingName
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

isValidThing=0
if [[ "$thingType" == "Server" ]]; then
  isValidThing=1
  echo "Registering a new thing as $thingType"
  read -p "Enter hardware version [V1]: " hardwareVersion
  read -p "Enter AWS region [eu-central-1, us-east-1]: " region
  read -p "Enter the default language [de, en, es]: " language
  echo "REGION=$region" >> .env
  echo "TYPE=$thingType" >> .env
  echo "THINGNAME=$thingName" >> .env
  echo "VUE_APP_SERVER_IP=192.168.55.17" >> .env
  echo "BOX_ID=$thingName" >> .env
  echo "AWS_REGION=$region" >> .env
  echo "EVENTSTABLE=boxevents" >> .env
  echo "DOC_BUCKET=doc.myapp.cafe" >> .env
  echo "MYAPPCAFESERVER_PATH=/home/pi/srv/MyAppCafeControl/" >> .env
  echo "LOCALPROXY_PATH=/home/pi/aws-iot-securetunneling-localproxy" >> .env
  echo "VUE_APP_PLU_PORT=8000" >> .env
  echo "VUE_APP_MAINSERVER_PORT=5002" >> .env
  echo "VUE_APP_LANGUAGE=$language"

fi


# ********************************************
# *** REGISTER THING
# ********************************************

echo "installing packages for MyAppCafeControl"
cd ~/srv/MyAppCafeControl
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
echo "Adding thing to thing-groups"
aws iot add-thing-to-thing-group --region $region --thing-group-name boxes --thing-name $thingName
aws iot add-thing-to-thing-group --region $region --thing-group-name $thingGroup --thing-name $thingName

# create role alias
echo "creating role alias"
aws iot create-role-alias --region eu-central-1 --role-arn arn:aws:iam::311842024294:role/iot-update-role --role-alias $thingName-iot-update-role-alias --credential-duration-seconds 3600

echo "downloading current solution"
aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin 311842024294.dkr.ecr.eu-central-1.amazonaws.com
docker-compose pull

echo ""
echo "# ********************************************"
echo "# *** Registration complete *** "
echo "# *** Successfully registered $thingName as $thingType in $region *** "
echo "# *** Downloaded current solution *** "
echo "# ********************************************"
echo "  "