#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts
logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - executing once script 4 as $(whoami)" >> $logfile

echo "$(date) removing crontab" >> $logfile
crontab -r # remove current crontab

# rewrite crontab
crontab -l | { cat; echo "0 4 * * 0 /usr/bin/docker system prune -f"; } | crontab -
crontab -l | { cat; echo "@reboot . /home/pi/srv/MyAppCafeControl/scripts/update_myappcafecontrol.sh"; } | crontab -
crontab -l | { cat; echo "0 2 * * * . /home/pi/srv/MyAppCafeControl/scripts/update_myappcafecontrol.sh"; } | crontab -

echo "$(date) MyAppCafé - Control - finished executing once script 4" >> $logfile