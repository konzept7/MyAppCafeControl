#!/bin/bash

echo
echo '#########################'
echo '   MyAppCafé - Control'
echo '      UPDATE SCRIPT'
echo '#########################'
echo

echo "$(date) Updating MyAppCafé - Control..."  > $logfile

SCRIPTFILE=/etc/systemd/system/myappcafecontrol.service

# check if service script exists, if not create it
if [[ ! -f "$SCRIPTFILE" ]]; then
    echo "$(date) Creating service script..." > $logfile
    # create script file
    cd /home/pi/
    sudo rm myappcafecontrol.service
    echo '[Unit]' | sudo tee -a myappcafecontrol.service
    echo 'Description=MyAppCafeControl' | sudo tee -a myappcafecontrol.service
    echo 'After=network.target systemd-timesyncd' | sudo tee -a myappcafecontrol.service
    echo '' | sudo tee -a myappcafecontrol.service
    echo '[Service]' | sudo tee -a myappcafecontrol.service
    echo 'ExecStart=node $workdir/dist/index.js' | sudo tee -a myappcafecontrol.service
    echo 'WorkingDirectory=$workdir/' | sudo tee -a myappcafecontrol.service
    echo 'StandardOutput=$workdir/log.txt' | sudo tee -a myappcafecontrol.service
    echo 'StandardError=$workdir/log.txt' | sudo tee -a myappcafecontrol.service
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
fi


# update service
# first shutdown service

workdir=/home/pi/srv/MyAppCafeControl
logfile=$workdir/update.log
dependencies=$workdir/dependencies
echo "$(date) Stopping service..." > $logfile
sudo systemctl stop myappcafecontrol.service
# pull current version

cd $workdir || exit
echo "$(date) Pulling current version..." > $logfile
git checkout .
git pull origin master
echo "$(date) Installing dependencies..." > $logfile
npm install
cd $workdir/node_modules || exit

# download aws-crt if it does not exist
echo "$(date) Checking aws-crt..." > $logfile
if [[ ! -d "$dependencies/aws-crt/aws-crt" ]]; then
    echo "$(date) Downloading aws-crt..." > $logfile
    mkdir -p $dependencies/aws-crt
    cd $dependencies/aws-crt || exit
    wget https://s3.amazonaws.com/iot.myapp.cafe/public/aws-crt.zip
    echo "$(date) Unzipping aws-crt..." > $logfile
    unzip -o aws-crt.zip
    echo "$(date) Unzipped aws-crt.zip..." > $logfile
fi
cd $workdir || exit

# echo "$(date) Copying aws-crt..." > $logfile
# rm -rf node_modules/aws-crt
# cp -r /home/pi/dependencies/aws-crt/aws-crt node_modules/aws-crt

echo "$(date) Building project..." > $logfile
npm run build
# restart service after build

echo "$(date) Starting service..." > $logfile
sudo systemctl start myappcafecontrol.service
