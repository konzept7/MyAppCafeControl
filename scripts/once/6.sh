#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts

echo "$(date) MyAppCafé - Control - executing once script 6 as $(whoami)"

# update npm
echo "$(date) MyAppCafé - Control - updating npm" 
npm install -g npm

echo "$(date) MyAppCafé - Control - finished executing once script 6" 