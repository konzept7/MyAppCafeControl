#!/bin/bash

# get current time from ntp before doing anything

if [ -e "./.env" ]; then
  echo ".env file already exists. If you want the script to run, you have to delete it."
fi

read -p "Enter name for new thing: " thingName
read -p "Enter type of new thing [server, gate, cam, display] : " thingType

isValidThing=0
if [ $thingType -eq "server" ]; then
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

# create new certificates
# 

# get a new certificate
# aws iot create-keys-and-certificate --set-as-active --certificate-pem-outfile me.cert.pem --public-key-outfile me.public.key --private-key-outfile me.private.key --set-as-active | jq -> store cert arn
# aws s3 cp me.public.key s3://token.myapp.cafe/$thingName.public.key
# wget rootcert
# attach policy

# neues thing
# aws iot create-thing --thing-name batter01 --thing-type-name baseball_device --attribute-payload "{\"attributes\": {\"Owner\":\"name\"}}"
# cert atttachen an thing
# aws iot attach-thing-principal --thing-name batter01 --principal <certificate-arn>
# policy für zugriff erstellen und attachen (mal gucken ob notwendig)
# aws iot create-policy --policy-name batterpolicy --policy-document file://batterpolicy.json
# aws iot attach-policy --target <certificate arn> --policy-name batterpolicy
# ********************************************
# *** PULL PROGRAM
# ********************************************