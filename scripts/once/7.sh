#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts

echo "$(date) MyAppCafé - Control - executing once script 7 as $(whoami)" 


echo "$(date) MyAppCafé - Control - rebuilding MyAppCafeControl"
cd /home/pi/srv/MyAppCafeControl
rm -rf /home/pi/srv/MyAppCafeControl/node_modules
npm install

npm run build

echo "$(date) MyAppCafé - Control - finished executing once script 7"