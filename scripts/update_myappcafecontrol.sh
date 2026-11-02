#!/bin/bash

echo
echo '#########################'
echo '   MyAppCafé - Control'
echo '      UPDATE SCRIPT'
echo '#########################'
echo


workdir=/home/pi/srv/MyAppCafeControl

echo "$(date) Updating MyAppCafé - Control..." 

SCRIPTFILE=/etc/systemd/system/myappcafecontrol.service

# check if service script exists, if not create it
if [[ ! -f "$SCRIPTFILE" ]]; then
    echo "$(date) Creating service script..."
    # create script file
    cd /home/pi/
    sudo rm myappcafecontrol.service
    echo '[Unit]' | sudo tee -a myappcafecontrol.service
    echo 'Description=MyAppCafeControl' | sudo tee -a myappcafecontrol.service
    echo 'After=network.target systemd-timesyncd' | sudo tee -a myappcafecontrol.service
    echo '' | sudo tee -a myappcafecontrol.service
    echo '[Service]' | sudo tee -a myappcafecontrol.service
    echo "ExecStart=node $workdir/dist/index.js" | sudo tee -a myappcafecontrol.service
    echo "WorkingDirectory=$workdir/" | sudo tee -a myappcafecontrol.service
    echo "StandardOutput=$workdir/log.txt" | sudo tee -a myappcafecontrol.service
    echo "StandardError=$workdir/log.txt" | sudo tee -a myappcafecontrol.service
    echo 'RestartSec=10' | sudo tee -a myappcafecontrol.service
    echo 'Restart=on-failure' | sudo tee -a myappcafecontrol.service
    echo 'StartLimitIntervalSec=60' | sudo tee -a myappcafecontrol.service
    echo 'StartLimitBurst=100' | sudo tee -a myappcafecontrol.service
    echo 'User=pi' | sudo tee -a myappcafecontrol.service
    echo '' | sudo tee -a myappcafecontrol.service
    echo '[Install]' | sudo tee -a myappcafecontrol.service
    echo 'WantedBy=multi-user.target' | sudo tee -a myappcafecontrol.service

    # reload services and start service
    sudo mv myappcafecontrol.service $SCRIPTFILE
    sudo systemctl daemon-reload
    sudo systemctl enable myappcafecontrol.service
    sudo systemctl start myappcafecontrol.service

    echo "$(date) Service script created..."
fi

echo "$(date) Run once.sh script"
chmod +x $workdir/scripts/once.sh
/home/pi/srv/MyAppCafeControl/scripts/once.sh >> /home/pi/srv/MyAppCafeControl/scripts/once.log

echo "$(date) Checking for changes in remote repository..."
# cron starts in /home/pi; outside the repository both versions below would be
# empty and compare as changed.
# The crontab sources this file with /bin/sh (dash), so keep it POSIX.
cd $workdir || exit 1
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

if [ -z "$LOCAL" ] || [ -z "$REMOTE" ]; then
    echo "$(date) Could not read the local or remote version. Exiting..."
    exit 1
fi
if [ "$LOCAL" != "$REMOTE" ]; then
    echo "$(date) Changes detected in remote repository. Updating..."
else
    echo "$(date) No changes detected in remote repository. Exiting..."
    exit 0
fi

echo "$(date) Stopping service..."
sudo systemctl stop myappcafecontrol.service

# pull current version
echo "$(date) Pulling current version..."
git checkout .
git pull origin master

# compare with the version before the pull; the working tree always matches the
# new HEAD after it
if ! git diff --quiet "$LOCAL" HEAD -- package.json; then
    echo "$(date) package.json has changed. Installing dependencies..."
    if ! npm install; then
        echo "$(date) ERROR: npm install failed, building with the installed dependencies"
    fi
else
    echo "$(date) package.json has not changed. Skipping dependency installation..."
fi

echo "$(date) Building project..."
build_ok=true
if ! npm run build; then
    build_ok=false
    # tsc --build emits nothing when it reports an error
    echo "$(date) ERROR: build failed, dist/ still holds the previous build and the service starts with it"
fi

# restart service after build
echo "$(date) Starting service..."
sudo systemctl start myappcafecontrol.service

if [ "$build_ok" = false ]; then
    exit 1
fi
