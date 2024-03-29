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
git fetch origin
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse @{u})

if [ $LOCAL != $REMOTE ]; then
    echo "$(date) Changes detected in remote repository. Updating..."
else
    echo "$(date) No changes detected in remote repository. Exiting..."
    exit 0
fi

echo "$(date) Stopping service..."
sudo systemctl stop myappcafecontrol.service

# pull current version
cd $workdir || exit
echo "$(date) Pulling current version..."
git checkout .
git pull origin master

# Check if package.json has changed
if ! git diff --quiet HEAD package.json; then
    echo "$(date) package.json has changed. Installing dependencies..."
    npm install
else
    echo "$(date) package.json has not changed. Skipping dependency installation..."
fi

echo "$(date) Building project..."
npm run build

# restart service after build
echo "$(date) Starting service..."
sudo systemctl start myappcafecontrol.service
