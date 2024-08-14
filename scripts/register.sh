#!/bin/bash

if [[ -e "./.env" ]]; then
  echo ".env file already exists. If you want the script to run, you have to delete it."
  exit 1
fi

echo "****************************************************************"
echo "*** This script needs temporary session tokens for AWS access. "
echo "*** Please prepare by calling 'aws sts get-session-token'"
echo "*** from *your* host machine"
echo "****************************************************************"


if ! aws sts get-caller-identity; then
  read -r -p "Enter AWS AccessKey : " accessKey
  read -r -p "Enter AWS SecretKey : " secretKey
  read -r -p "Enter AWS Session Token : " sessionToken

  export AWS_SECRET_ACCESS_KEY=$secretKey
  export AWS_ACCESS_KEY_ID=$accessKey
  export AWS_SESSION_TOKEN=$sessionToken
else
    echo "valid AWS credentials "
fi

read -r -p "[only: a-z, A-Z, 0-9, _, -] Enter the thing name (box id): " thingName
while [[ ! "$thingName" =~ ^[a-zA-Z0-9_-]+$ ]]; do
  echo "Invalid thing name. Only a-z, A-Z, 0-9, _, - are allowed."
  read -r -p "[only: a-z, A-Z, 0-9, _, -] Enter the thing name (box id): " thingName
done

# read -r -p "Enter type of new thing [Server, gate, cam, display] : " thingType
thingType=Box

read -r -p "[de, us, at, fr] Enter the lower case 2-digit country code where the box will be located: " thingChildGroup
while [[ ! "$thingChildGroup" =~ ^(de|us|at|fr)$ ]]; do
  read -r -p "Invalid country code. Please enter de, us, at or fr: " thingChildGroup
done

echo "****************************************************************"
echo "Naming convention for nice names: <2-digit country code in uppercase>_<city>_<location-name> -> DE_Karlsruhe_Postgalerie"
echo "*** PLEASE REPLACE DIACRITICS WHEN ENTERING THE ATTRIBUTES ***"
echo "*** space -> _ | ö -> @oe, Ö -> @Oe | ß -> @ss, é -> @e"
echo "****************************************************************"
read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the city where the unit will be located : " city
while [[ ! $city =~ ^[a-zA-Z0-9_@.]+$ ]]; do
  echo "Invalid city name. Only a-z, A-Z, 0-9, _, @, . are allowed."
  read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the city where the unit will be located : " city
done
read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the zip code where the unit will be located : " zip
while [[ ! $zip =~ ^[a-zA-Z0-9_@.]+$ ]]; do
  echo "Invalid zip code. Only a-z, A-Z, 0-9, _, @, . are allowed."
  read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the zip code where the unit will be located : " zip
done
read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the street and house number where the unit will be located : " street
while [[ ! $street =~ ^[a-zA-Z0-9_@.]+$ ]]; do
  echo "Invalid street name. Only a-z, A-Z, 0-9, _ , @, .are allowed."
  read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the street and house number where the unit will be located : " street
done
read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the location name (Shopping_Center_Nord, Stadtgalerie)" locationname
while [[ ! $locationname =~ ^[a-zA-Z0-9_@.]+$ ]]; do
  echo "Invalid location name. Only a-z, A-Z, 0-9, _, @, . are allowed."
  read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the location name (Shopping_Center_Nord, Stadtgalerie)" locationname
done
read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the company name (MyAppCaf@e)" companyname
while [[ ! $companyname =~ ^[a-zA-Z0-9_@.]+$ ]]; do
  echo "Invalid company name. Only a-z, A-Z, 0-9, _, @, . are allowed."
  read -r -p "[only: a-z, A-Z, 0-9, _, @, .] Enter the company name (MyAppCaf@e)" companyname
done

country="Deutschland"
if [ "$thingChildGroup" == "us" ]; then
  country="USA"
fi
if [ "$thingChildGroup" == "at" ]; then
  country="@Oesterreich"
fi
if [ "$thingChildGroup" == "fr" ]; then
  country="France"
fi

srcDir=/home/pi/srv/MyAppCafeControl

nicename="$companyname#$locationname"
location="$country#""$city""_$zip#$street"
hierarchyId="E#MAC#${thingChildGroup^^}#$companyname#$thingName"

userpool=eu-central-1_7iLxD02o9
clientid=41bsovn23a01gv0ogt1ag2ih2p

if [[ "$thingType" != "Box" ]]; then
  exit 7
fi
echo "Registering a new thing as $thingType"
region=eu-central-1
read -r -p "Enter the default language [de, en, es]: " language
{
  echo "REGION=$region"
  echo "TYPE=$thingType"
  echo "THINGNAME=$thingName"
  echo "VUE_APP_SERVER_IP=192.168.155.17"
  echo "BOXID=$thingName"
  echo "AWS_REGION=$region"
  echo "EVENTSTABLE=boxevents"
  echo "DOC_BUCKET=doc.myapp.cafe"
  echo "MYAPPCAFESERVER_PATH=$srcDir/"
  echo "LOCALPROXY_PATH=/home/pi/aws-iot-securetunneling-localproxy/build/bin"
  echo "VUE_APP_PLU_PORT=8000"
  echo "VUE_APP_MAINSERVER_PORT=5002"
  echo "VUE_APP_LANGUAGE=$language"
  echo "COGNITO_POOL=$userpool"
  echo "COGNITO_CLIENT=$clientid"
  echo "COMPOSE_COMMAND=docker compose"
} >> $srcDir/.env


# ********************************************
# *** REGISTER THING
# ********************************************

echo "installing packages for MyAppCafeControl"
cd $srcDir || exit
npm install
npm run build

# get a new certificate
echo "Creating keys and certificates"
cd $srcDir || exit

certArn=$(aws iot create-keys-and-certificate --region "$region" --set-as-active --certificate-pem-outfile me.cert.pem --public-key-outfile me.public.key --private-key-outfile me.private.key | jq -r '.certificateArn')

echo "created certificate with ARN $certArn in region $region"


echo "Get root certificates"
sudo wget -O root-CA.crt https://www.amazontrust.com/repository/AmazonRootCA1.pem

echo "Converting pem files to pfx"
openssl pkcs12 -export -in me.cert.pem -inkey me.private.key -out me.cert.pfx -certfile root-CA.crt -passout pass:

echo "copying certificates in certs folder"
mkdir $srcDir/certs
cp me.cert.pem ./certs/me.cert.pem
cp me.cert.pfx ./certs/me.cert.pfx
cp root-CA.crt ./certs/root-CA.crt
cp me.private.key ./certs/me.private.key
cp me.public.key ./certs/me.public.key

aws s3 cp me.cert.pem s3://token.myapp.cafe/"$thingName"/me.cert.pem
aws s3 cp me.cert.pfx s3://token.myapp.cafe/"$thingName"/me.cert.pfx
aws s3 cp me.private.key s3://token.myapp.cafe/"$thingName"/me.private.key
aws s3 cp me.public.key s3://token.myapp.cafe/"$thingName"/me.public.key

# attach policy
echo "Attaching policies"
aws iot attach-policy --region "$region" --target "$certArn" --policy-name TutorialThing-Policy
aws iot attach-policy --region "$region" --target "$certArn" --policy-name AssumeRoleWithCertificate
aws iot attach-policy --region "$region" --target "$certArn" --policy-name box-server-policy
aws iot attach-policy --region "$region" --target "$certArn" --policy-name configpolicy
aws iot attach-policy --region "$region" --target "$certArn" --policy-name franchise-portal-policy

# new thing
echo "Creating new thing"
aws iot create-thing --region "$region" --thing-name "$thingName" --thing-type-name "$thingType" --attribute-payload "{\"attributes\": {\"hierarchyId\": \"$hierarchyId\", \"location\": \"$location\", \"nicename\": \"$nicename\"}}"

# cert atttachen an thing
echo "Attaching principal to thing"
aws iot attach-thing-principal --region "$region" --thing-name "$thingName" --principal "$certArn"

# add thing to group
echo "Adding thing to thing-groups"
aws iot add-thing-to-thing-group --region "$region" --thing-group-name "$thingChildGroup" --thing-name "$thingName"

# create role alias
echo "creating role aliases"
aws iot create-role-alias --region "$region" --role-arn arn:aws:iam::311842024294:role/iot-config-role --role-alias "$thingName"-iot-config-role-alias --credential-duration-seconds 3600
aws iot create-role-alias --region "$region" --role-arn arn:aws:iam::311842024294:role/iot-update-role --role-alias "$thingName"-iot-update-role-alias --credential-duration-seconds 3600
aws iot create-role-alias --region "$region" --role-arn arn:aws:iam::311842024294:role/iot-box-role --role-alias "$thingName"-iot-box-role-alias --credential-duration-seconds 43200

echo "downloading current solution"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin 311842024294.dkr.ecr.eu-central-1.amazonaws.com
docker-compose pull


username="$thingName"@myapp.cafe
tempPass=$(openssl rand -base64 16)
password=$(openssl rand -base64 16)


echo "box cognito password is $password. please check if it set in env file"
echo "COGNITO_PASSWORD=$password" >> $srcDir/.env

aws cognito-idp admin-create-user --user-pool-id "$userpool" --region "$region" --username "$thingName"@myapp.cafe --user-attributes Name=email,Value="$username" Name=custom:hierarchyId,Value=E#MAC#"$thingChildGroup"#"$thingName" --desired-delivery-mediums EMAIL --temporary-password "$tempPass"

session=$(aws cognito-idp admin-initiate-auth --user-pool-id "$userpool" --region "$region" --client-id "$clientid" --auth-flow ADMIN_NO_SRP_AUTH --auth-parameters USERNAME="$username",PASSWORD="$tempPass" | jq -r ".Session")
echo "session token is $session"
aws cognito-idp admin-respond-to-auth-challenge --region "$region" --user-pool-id "$userpool" --client-id "$clientid" --challenge-name NEW_PASSWORD_REQUIRED --challenge-responses NEW_PASSWORD="$password",USERNAME="$username" --session "$session"
aws cognito-idp admin-add-user-to-group --user-pool-id "$userpool" --region "$region" --username "$username" --group-name box
aws cognito-idp admin-add-user-to-group --user-pool-id "$userpool" --region "$region" --username "$username" --group-name wawi
aws cognito-idp admin-add-user-to-group --user-pool-id "$userpool" --region "$region" --username "$username" --group-name admin

aws s3 cp $srcDir/.env s3://token.myapp.cafe/"$thingName"/.env

echo "adding public key to authorized keys"
# Define the filename
mkdir -p /home/pi/.ssh/
touch /home/pi/.ssh/authorized_keys
publicKey=$(aws s3 cp s3://iot.myapp.cafe/keys/default-public-ssh-key/id_rsa.pub -)
echo "$publicKey" >> /home/pi/.ssh/authorized_keys

echo "creating video stream"

# if the country is "USA", then the streamRegion is "us-east-1", otherwise it is "eu-central-1"
streamRegion=$region
if [ "$thingChildGroup" == "us" ]; then
  streamRegion=us-east-1
fi

aws kinesisvideo create-stream --stream-name "$thingName" --data-retention-in-hours 72 --region "$streamRegion" --media-type "video/h264"

echo ""
echo "# ********************************************"
echo "# *** Registration complete *** "
echo "# *** registered $thingName as $thingType in $region *** "
echo "# *** Please check output for errors! *** "
echo "# *** Downloaded current solution *** "
echo "# ********************************************"
echo "  "