#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts
logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - executing once script 2" >> $logfile

# update npm
echo "$(date) MyAppCafé - Control - updating npm" >> $logfile
sudo npm install -g npm

echo "$(date) MyAppCafé - Control - finished executing once script 3" >> $logfile