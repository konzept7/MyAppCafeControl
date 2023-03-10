#!/bin/bash

echo
echo '#########################'
echo '   MyAppCafé - Control'
echo '      UPDATE SCRIPT'
echo '#########################'
echo


SCRIPTFILE=/etc/systemd/system/myappcafecontrol.service

# check if service script exists, if not create it
if [[ ! -f "$SCRIPTFILE" ]]; then
    # create script file
    cd /home/pi/
    sudo rm myappcafecontrol.service
    echo '[Unit]' | sudo tee -a myappcafecontrol.service
    echo 'Description=MyAppCafeControl' | sudo tee -a myappcafecontrol.service
    echo 'After=network.target systemd-timesyncd' | sudo tee -a myappcafecontrol.service
    echo '' | sudo tee -a myappcafecontrol.service
    echo '[Service]' | sudo tee -a myappcafecontrol.service
    echo 'ExecStart=node /home/pi/srv/MyAppCafeControl/dist/index.js' | sudo tee -a myappcafecontrol.service
    echo 'WorkingDirectory=/home/pi/srv/MyAppCafeControl/' | sudo tee -a myappcafecontrol.service
    echo 'StandardOutput=/home/pi/srv/MyAppCafeControl/log.txt' | sudo tee -a myappcafecontrol.service
    echo 'StandardError=/home/pi/srv/MyAppCafeControl/log.txt' | sudo tee -a myappcafecontrol.service
    echo 'RestartSec=10' | sudo tee -a myappcafecontrol.service
    echo 'Restart=on-failure' | sudo tee -a myappcafecontrol.service
    echo 'StartLimitIntervalSec=60' | sudo tee -a myappcafecontrol.service
    echo 'StartLimitBurst=10' | sudo tee -a myappcafecontrol.service
    echo 'User=pi' | sudo tee -a myappcafecontrol.service
    echo '' | sudo tee -a myappcafecontrol.service
    echo '[Install]' | sudo tee -a myappcafecontrol.service
    echo 'WantedBy=multi-user.target' | sudo tee -a myappcafecontrol.service

    # reload services and start service
    sudo mv myappcafecontrol.service $SCRIPTFILE
    sudo systemctl daemon-reload
    sudo systemctl enable myappcafecontrol.service
    sudo systemctl start myappcafecontrol.service
fi


# update service
# first shutdown service
sudo systemctl stop myappcafecontrol.service
# pull current version
cd /home/pi/srv/MyAppCafeControl
git checkout .
git pull origin master
npm install
npm run build
# restart service after build
sudo systemctl start myappcafecontrol.service
