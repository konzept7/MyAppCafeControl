#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts
logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - executing once script 5 as $(whoami)" >> $logfile

# install n
echo "$(date) MyAppCafé - Control - installing n" >> $logfile
sudo npm install -g n

# sudo mkdir -p /usr/local/n
# sudo chown -R $(whoami) /usr/local/n
# sudo mkdir -p /usr/local/bin /usr/local/lib /usr/local/include /usr/local/share
# sudo chown -R $(whoami) /usr/local/bin /usr/local/lib /usr/local/include /usr/local/share


# install node 14.21.3
sudo /usr/local/n 14.21.3

echo "$(date) MyAppCafé - Control - finished executing once script 5" >> $logfile