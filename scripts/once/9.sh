#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts
logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - executing once script 9 as $(whoami)" >> $logfile

# install n
echo "$(date) removing n local versions" >> $logfile
n prune
sudo rm /usr/local/bin/node

echo "$(date) updating apt" >> $logfile
sudo apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 7EA0A9C3F273FCD8
sudo apt update

echo "$(date) installing nodejs" >> $logfile
sudo apt install -y nodejs

echo "$(date) MyAppCafé - Control - finished executing once script 5" >> $logfile