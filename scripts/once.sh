#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts
version=0

# get the current version by listing all shell script files in the 'once' directory and taking the highest version number
version=$(ls -1 $workdir/once/*.sh | sed 's/.*\///' | sed 's/[^0-9]*//g' | sort -n | tail -1)

logfile=$workdir/once.log

echo "$(date) MyAppCafé - Control - Once script version $version" >> $logfile

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

# make all scripts executable
chmod +x $workdir/once/*.sh

# execute the scripts in the 'once' directory by version number
for file in $workdir/once/*.sh; do
    if [ -f "$file" ]; then
        file_version=$(echo "$file" | sed 's/.*\///' | sed 's/[^0-9]*//g')
        if [ "$file_version" -le "$version" ]; then
            echo "$(date) Executing $file" >> $logfile
            bash "$file"
        fi
    fi
done

echo "$(date) setting executed version flag to $version" >> $logfile
echo "$version" > "$flagfile"

# part that should not be executed if previous attempts failed
