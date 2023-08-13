#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts
logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - executing once script 6 as $(whoami)" >> $logfile

# update npm
echo "$(date) MyAppCafé - Control - updating npm" >> $logfile
npm install -g npm

echo "$(date) MyAppCafé - Control - finished executing once script 6" >> $logfile