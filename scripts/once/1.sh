#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts
rm -f $workdir/once.log
logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - executing once script 1 as $(whoami) just a placeholder" >> $logfile