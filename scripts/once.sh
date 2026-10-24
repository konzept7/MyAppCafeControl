#!/bin/bash

# Runs the one-time migration scripts in scripts/once/<N>.sh.
#
# Rules (keep them when editing this file, every box runs it from cron):
# - Scripts run in numeric order (1, 2, ..., 9, 10, 11, ...), not glob order.
# - The flag file holds the highest version that finished successfully. Only
#   scripts with a higher version run, so every script runs once per box.
# - A script that exits non-zero stops the run. The flag stays at the last
#   successful version and the failed script is retried on the next run.
# - A script that has nothing to do on a box (wrong OS, already done) must
#   exit 0, otherwise it blocks all later scripts on that box.

workdir=/home/pi/srv/MyAppCafeControl/scripts
logfile=$workdir/once.log
flagfile=$workdir/version_flag

# all versions found in the 'once' directory, numerically sorted
versions=$(ls -1 "$workdir"/once/*.sh 2>/dev/null | sed 's/.*\///; s/[^0-9]*//g' | grep -E '^[0-9]+$' | sort -nu)
version=$(echo "$versions" | tail -1)
version=${version:-0}

echo "$(date) MyAppCafé - Control - Once script version $version" >> "$logfile"

# highest version that was executed successfully
stored_version=0
if [ -f "$flagfile" ]; then
    stored_version=$(tr -dc '0-9' < "$flagfile")
    if [ -z "$stored_version" ]; then
        # do not guess: version 0 would re-run every migration on this box
        echo "$(date) Flag file $flagfile is empty or corrupt. Not running any once script, fix the flag file by hand" >> "$logfile"
        exit 1
    fi
else
    echo "$(date) No flag file found. Continuing..." >> "$logfile"
fi

if [ "$stored_version" -ge "$version" ]; then
    echo "$(date) Script version $version or newer has already been executed. Exiting..." >> "$logfile"
    exit 0
fi
echo "$(date) Script version $version is newer than the stored version $stored_version. Continuing..." >> "$logfile"

# make all scripts executable
chmod +x "$workdir"/once/*.sh

for file_version in $versions; do
    if [ "$file_version" -le "$stored_version" ]; then
        continue
    fi
    file=$workdir/once/$file_version.sh
    if [ ! -f "$file" ]; then
        echo "$(date) Skipping version $file_version, there is no file named $file" >> "$logfile"
        continue
    fi

    echo "$(date) Executing $file" >> "$logfile"
    bash "$file" >> "$logfile" 2>&1
    rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "$(date) $file failed with exit code $rc. Flag stays at $stored_version, the script will be retried on the next run" >> "$logfile"
        exit 1
    fi

    stored_version=$file_version
    echo "$(date) setting executed version flag to $file_version" >> "$logfile"
    echo "$file_version" > "$flagfile"
done
