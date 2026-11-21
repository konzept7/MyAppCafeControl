#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts

echo "$(date) MyAppCafé - Control - executing once script 11 as $(whoami)"

# dhcpcd crashes on Docker interface churn and then lets the eth0 lease expire
# (box 66_-73-P0SGDo offline on 2026-11-20). Keep dhcpcd off Docker's interfaces
# and restart it when it dies. A no-op on boxes without dhcpcd.
bash $workdir/dhcpcd-ignore-docker.sh
rc=$?

echo "$(date) MyAppCafé - Control - finished executing once script 11 with exit code $rc"
exit $rc
