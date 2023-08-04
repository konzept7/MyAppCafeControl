#!/bin/bash

echo
echo '#########################'
echo '   MyAppCafé - Control'
echo '      UPDATE SCRIPT'
echo '#########################'
echo

echo "$(date) Updating MyAppCafé - Control..."  >> /home/pi/srv/MyAppCafeControl/update.log

SCRIPTFILE=/etc/systemd/system/myappcafecontrol.service

# check if service script exists, if not create it
if [[ ! -f "$SCRIPTFILE" ]]; then
    echo "$(date) Creating service script..." >> /home/pi/srv/MyAppCafeControl/update.log
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

    echo "$(date) Service script created..." >> /home/pi/srv/MyAppCafeControl/update.log
fi


# update service
# first shutdown service
echo "$(date) Stopping service..." >> /home/pi/srv/MyAppCafeControl/update.log
sudo systemctl stop myappcafecontrol.service
# pull current version
cd /home/pi/srv/MyAppCafeControl
echo "$(date) Pulling current version..." >> /home/pi/srv/MyAppCafeControl/update.log
git checkout .
git pull origin master
echo "$(date) Installing dependencies..." >> /home/pi/srv/MyAppCafeControl/update.log
npm install
cd node_modules

# download aws-crt if it does not exist
echo "$(date) Checking aws-crt..." >> /home/pi/srv/MyAppCafeControl/update.log
if [[ ! -d "/home/pi/dependencies/aws-crt/aws-crt" ]]; then
    echo "$(date) Downloading aws-crt..." >> /home/pi/srv/MyAppCafeControl/update.log
    mkdir -p /home/pi/dependencies/aws-crt
    cd /home/pi/dependencies/aws-crt
    wget https://s3.amazonaws.com/iot.myapp.cafe/public/aws-crt.zip
    echo "$(date) Unzipping aws-crt..." >> /home/pi/srv/MyAppCafeControl/update.log
    unzip -o aws-crt.zip
    echo "$(date) Unzipped aws-crt.zip..." >> /home/pi/srv/MyAppCafeControl/update.log
fi
cd /home/pi/srv/MyAppCafeControl

echo "$(date) Copying aws-crt..." >> /home/pi/srv/MyAppCafeControl/update.log
rm -rf node_modules/aws-crt
cp -r /home/pi/dependencies/aws-crt/aws-crt node_modules/aws-crt

echo "$(date) Building project..." >> /home/pi/srv/MyAppCafeControl/update.log
npm run build
# restart service after build

echo "$(date) Starting service..." >> /home/pi/srv/MyAppCafeControl/update.log
sudo systemctl start myappcafecontrol.service
