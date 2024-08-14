#!/bin/bash

read -p "Enter thing name: " thingName
read -p "Enter tunnel timeout in minutes: " timeOut
if ! [[ $timeOut =~ ^[0-9]+$ ]]
  echo please enter a timeout between 10 and 720
  exit
fi 
if [ $timeOut -gt 720 -o $timeOut -lt 10 ]; then
  echo please enter a timeout between 10 and 720
  exit
fi
if [ -e  ]

aws iotsecuretunneling open-tunnel --destination-config thingName=$thingName,services=SSH --timeout-config maxLifetimeTimeoutMinutes=$timeOut | echo $message | destinationToken=$(jq '.destinationAccessToken')
echo connecting with destination token $destinationToken
nohup ./localproxy -r $REGION -s 18022 -t $destinationToken &>tunnel.log
sleep 120
ssh pi@localhost -p 18022