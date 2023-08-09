#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts
logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - executing once script 4" >> $logfile


echo "$(date) MyAppCafé - Control - rebuilding MyAppCafeControl" >> $logfile
cd /home/pi/srv/MyAppCafeControl
npm install
npm ci
npm run build

echo "$(date) MyAppCafé - Control - finished executing once script 2" >> $logfile