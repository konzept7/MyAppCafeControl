#!/bin/bash

version=1

workdir=/home/pi/srv/MyAppCafeControl/scripts
logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - Once script version $version" >> $logfile

# !!! START: DO NOT CHANGE THIS PART OF THE SCRIPT !!!

# Check if the flag file exists and contains a version number
flagfile=$workdir/version_flag
if [ -f "$flagfile" ]; then
    stored_version=$(cat "$flagfile")
    if [ "$stored_version" -ge "$version" ]; then
        echo "$(date) Script version $version or newer has already been executed. Exiting..." >> $logfile
        exit 0
    else
        echo "$(date) Script version $version is newer than the stored version $stored_version. Continuing..." >> $logfile
    fi
else
    echo "$(date) No flag file found. Continuing..." >> $logfile
fi

# !!! END !!!

# part that should be executed even if previous attempts failed

echo "$(date) add daily check at 2am to crontab..." >> $logfile
(crontab -l 2>/dev/null; echo "0 2 * * * /home/pi/srv/MyAppCafeControl/scripts/update_myappcafecontrol.sh") | crontab -

echo "$(date) updating from $(node -v) latest version of node" >> $logfile
sudo npm install -g n
sudo n 14.21.3
hash -r
echo "$(date) updated node to $(node -v)" >> $logfile

echo "$(date) updating latest version of npm" >> $logfile
sudo npm install -g npm

echo "$(date) setting executed version flag to $version" >> $logfile
echo "$version" > "$flagfile"

# part that should not be executed if previous attempts failed
