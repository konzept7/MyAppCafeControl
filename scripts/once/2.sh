#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts
logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - executing once script 2" >> $logfile

# install n
echo "$(date) MyAppCafé - Control - installing n" >> $logfile
sudo npm install -g n

# install node 14.21.3
sudo /usr/bin/n 14.21.3

echo "$(date) MyAppCafé - Control - finished executing once script 2" >> $logfile