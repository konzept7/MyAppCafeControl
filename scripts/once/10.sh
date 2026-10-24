#!/bin/bash

workdir=/home/pi/srv/MyAppCafeControl/scripts

echo "$(date) MyAppCafé - Control - executing once script 10 as $(whoami)"

# Issue #16: upgrade libseccomp2 from buster-backports on Buster boxes.
# Docker is NOT restarted here. The control program restarts it the next time
# it stops the whole compose stack (update, shutdown, start hard/forced), or the
# next reboot applies it. On non-Buster boxes this is a no-op.
bash $workdir/upgrade-libseccomp-buster.sh --mark-restart $workdir/docker-restart-pending
rc=$?

echo "$(date) MyAppCafé - Control - finished executing once script 10 with exit code $rc"
exit $rc
