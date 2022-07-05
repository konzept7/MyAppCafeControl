#!/bin/bash

echo
echo '########################'
echo '       MyAppCafé'
echo '     INSTALL SCRIPT'
echo '########################'
echo

if [[ "$1" == "" ]] || [[ "$1" == "help" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "--h" ]]; then
    echo
    echo "HELP"
    echo "    Install script to auto-configure pi to be integrated into MyAppCafé-Box."
    echo "    Use arguments to configure this pi to your liking."
    echo
    echo "SYNTAX"
    echo "    install_myappcafe.sh PACKAGE HOSTNAME PASSWORD [RESOLUTION] [SERVERIP] [SERVERPORT] [STREAMNAME] [AWSACCESS] [AWSSECRET] [AWSREGION]"
    echo
    echo "DESCRIPTION"
    echo "    PACKAGE     define generic software and config setup (see below)"
    echo "    HOSTNAME    hostname for this machine"
    echo "    PASSWORD    set password for user 'pi'"
    echo "    RESOLUTION  set resolution for kiosk mode, e.g. 1366,768 or 1920,1080"
    echo "    SERVERIP    define ip for the server to grab the webpage from (in desktop mode)"
    echo "    SERVERPORT  define port to grab the webpage from (in desktop mode)"
    echo "    STREAMNAME  define name for the camera stream (when installing camera package)"
    echo "    AWSACCESS   define AWS Access Key (when installing camera package)"
    echo "    AWSSECRET   define AWS Secret Key (when installing camera package)"
    echo "    AWSREGION   define AWS Region (when installing camera package)"
    echo
    echo "PACKAGES"
    echo "    server        desktop, browserkiosk, docker, docker-compose"
    echo "    display       browserkiosk"
    echo "    camera        console, camera-setup, stream-setup"
    echo "    gate          console, docker"
    echo
    echo "Example:"
    echo "  ./install_myappcafe.sh display queue abc123 1920,1080 192.168.0.17 5007"
    echo
    exit 0
fi
if [[ "$1" == "--version" ]] || [[ "$1" == "--v" ]]; then
    echo "Version 1.5"
    echo
    exit 0
fi


installationPackage=$1
hostname=$2
password=$3
resolution=$4
serverip=$5
serverport=$6
streamname=$7
awsaccess=$8
awssecret=$9
awsregion=$10

# check incoming arguments
if [[ "$hostname" == "" ]]; then
    echo "  <Hostname> needs to be set!"
    exit 0
fi
if [[ "$password" == "" ]]; then
    echo "  <Password> needs to be set!"
    exit 0
fi

if [[ "$installationPackage" == "server" ]] || [[ "$installationPackage" == "display" ]]; then
    if [[ "$resolution" == "" ]]; then
        echo "  <Resolution> needs to be set, when installing server or display-devices!"
        exit 0
    fi
    if [[ "$serverip" == "" ]]; then
        echo "  <ServerIP> needs to be set, when installing server or display-devices!"
        exit 0
    fi
    if [[ "$serverport" == "" ]]; then
        echo "  <ServerPort> needs to be set, when installing server or display-devices!"
        exit 0
    fi
fi

if [[ "$installationPackage" == "camera" ]]; then
    if [[ "$streamname" == "" ]]; then
        echo "  <StreamName> needs to be set, when installing camera!"
        exit 0
    fi
    if [[ "$awsaccess" == "" ]]; then
        echo "  <AWS Access Key> needs to be set, when installing camera!"
        exit 0
    fi
    if [[ "$awssecret" == "" ]]; then
        echo "  <AWS Secret Key> needs to be set, when installing camera!"
        exit 0
    fi
    if [[ "$awsregion" == "" ]]; then
        echo "  <AWS Region> needs to be set, when installing camera!"
        exit 0
    fi
fi


echo 'Configuring pi...'
echo "  - changing password"
sudo usermod --password $(echo $password | openssl passwd -1 -stdin) pi

echo "  - setting hostname"
sudo sed -i -E 's/127.0.1.1\t.+/127.0.1.1\t'$hostname'/' /etc/hosts
sudo rm /etc/hostname
echo $hostname | sudo tee -a /etc/hostname

echo "  - disabling wifi and bluetooth"
echo 'dtoverlay=disable-wifi' | sudo tee -a /boot/config.txt
echo 'dtoverlay=disable-bt' | sudo tee -a /boot/config.txt

echo "  - disabling IPv6"
echo 'net.ipv6.conf.all.disable_ipv6=1' | sudo tee -a /etc/sysctl.conf
echo 'net.ipv6.conf.default.disable_ipv6=1' | sudo tee -a /etc/sysctl.conf
echo 'net.ipv6.conf.lo.disable_ipv6=1' | sudo tee -a /etc/sysctl.conf
echo 'net.ipv6.conf.eth0.disable_ipv6=1' | sudo tee -a /etc/sysctl.conf
echo '-----------------------------------------------------------'
echo

echo "  - enabling SSH"
sudo systemctl enable ssh
sudo systemctl start ssh


echo '-----------------------------------------------------------'
echo
echo 'Updating pi...'
sudo apt-get update && sudo apt-get -y upgrade && sudo apt-get -y dist-upgrade
echo '-----------------------------------------------------------'
echo



if [[ "$installationPackage" != "gate" ]]; then
    echo "Installing git..."
    sudo apt install -y git

    echo "Installing node..."
    cd /home/pi/
    curl -sSL https://deb.nodesource.com/setup_14.x | sudo bash -
    sudo apt install -y nodejs

    echo "Installing jq"
    sudo apt install -y jq
fi

if [[ "$installationPackage" == "server" ]] || [[ "$installationPackage" == "gate" ]]; then
    echo "Installing docker..."
    sudo apt-get install apt-transport-https ca-certificates software-properties-common -y
    curl -fsSL get.docker.com -o get-docker.sh && sh get-docker.sh
    sudo usermod -aG docker pi
    sudo curl https://download.docker.com/linux/raspbian/gpg | sudo apt-key add -
    echo 'deb https://download.docker.com/linux/raspbian/ stretch stable' | sudo tee -a /etc/apt/sources.list
    sudo apt-get -y update && sudo apt-get -y upgrade
    sudo systemctl start docker.service

    if [[ "$installationPackage" == "server" ]]; then

        echo "Installing AWS CRT"
        cd /home/pi/srv
        git clone https://github.com/awslabs/aws-crt-nodejs.git
        cd /home/pi/srv/aws-crt-nodejs
        git submodule update --init
        npm install
        cp -r /home/pi/srv/aws-crt-nodejs/dist/bin/linux-arm /home/pi/srv/MyAppCafeControl/node_modules/aws-crt/dist/bin/linux-arm

        echo "Installing docker-compose"
        sudo apt-get install libffi-dev libssl-dev python3 python3-pip python3-dev -y
        sudo pip3 install docker-compose==1.26.0
        (crontab -l ; echo "0 4 * * 0 /usr/bin/docker system prune -f")| crontab -

        echo "Installing cmake"
        sudo apt-get install cmake -y

        echo "Installing aws cli"
        pip3 install awscli --upgrade --user

        echo "Installing nmap"
        sudo apt install nmap

        echo "Installing VNC"
        sudo apt install realvnc-vnc-server
    fi
    echo '-----------------------------------------------------------'
fi


# install and set up browser kiosk
if [[ "$installationPackage" == "server" ]] || [[ "$installationPackage" == "display" ]]; then
    echo 'Installing required software for browser-kiosk...'
    sudo apt-get -y install chromium-browser unclutter lightdm
    echo '-----------------------------------------------------------'
    echo

    # set resolution
    if [[ "$resolution" == "1366,768" ]]; then
        echo "Resolution 1366x768 needs special handling"
        sudo sed /boot/config.txt -i -e "s/^\(#\|\)hdmi_group=.*/hdmi_group=2/"
        sudo sed /boot/config.txt -i -e "s/^\(#\|\)hdmi_mode=.*/hdmi_mode=87\nhdmi_cvt=1360 768 60/"
        # modify resolution of browser to fit to compatibilty mode - see https://www.raspberrypi.org/documentation/configuration/config-txt/pi4-hdmi.md
        resolution="1360,768"
    fi


    echo 'Setting up Xsession file...'
    echo 'xset s off' > /home/pi/.Xsession
    echo 'xset -dpms' >> /home/pi/.Xsession
    echo 'xset s noblank' >> /home/pi/.Xsession
    echo 'sed -i '"'"'s/"exited_cleanly": false/"exited_cleanly": true/'"'"' /home/pi/.config/chromium/Default/Preferences' >> /home/pi/.Xsession
    echo 'chromium-browser --noerrdialogs http://'$serverip':'$serverport'/ --incognito --kiosk --start-fullscreen --disable-translate --disable-features=Translate --window-size='$resolution' --window-position=0,0 --check-for-update-interval=604800 --disable-pinch --overscroll-history-navigation=0' >> /home/pi/.Xsession

    sudo chown pi:pi /home/pi/.Xsession


    # boot to desktop
    sudo systemctl set-default graphical.target
    sudo ln -fs /lib/systemd/system/getty@.service /etc/systemd/system/getty.target.wants/getty@tty1.service

    sudo rm /etc/systemd/system/getty@tty1.service.d/autologin.conf

    echo '[Service]' | sudo tee -a /etc/systemd/system/getty@tty1.service.d/autologin.conf
    echo 'ExecStart=' | sudo tee -a /etc/systemd/system/getty@tty1.service.d/autologin.conf
    echo 'ExecStart=-/sbin/agetty --autologin pi --noclear %I $TERM' | sudo tee -a /etc/systemd/system/getty@tty1.service.d/autologin.conf
    sudo sed /etc/lightdm/lightdm.conf -i -e "s/^\(#\|\)autologin-user=.*/autologin-user=pi/"
    sudo sed /etc/lightdm/lightdm.conf -i -e "s/^\(#\|\)xserver-command=.*/xserver-command=X -nocursor/"

    sudo rm -f /etc/profile.d/raspi-config.sh
    sudo rm /etc/systemd/system/getty@tty1.service.d/raspi-config-override.conf
    sudo telinit q
    echo '-----------------------------------------------------------'
    echo

    # update myappcafecontrol during boot (make sure file is executable)
    # and every month on the 15th, because we usually don't reboot
    sudo chmod ugo+x /home/pi/srv/MyAppCafeControl/scripts/update_myappcafecontrol.sh
    (crontab -l ; echo "@reboot /home/pi/srv/MyAppCafeControl/scripts/update_myappcafecontrol.sh") | crontab -
    (crontab -l ; echo "0 2 15 * * /home/pi/srv/MyAppCafeControl/scripts/update_myappcafecontrol.sh") | crontab -
    # fallback solution for script-hang (nightly restart)
    (crontab -l ; echo "30 2 * * * sudo systemctl restart myappcafecontrol.service") | crontab -

    # for display-only devices set up quiet/invisible boot
    if [[ "$installationPackage" == "display" ]]; then
        echo 'disable_splash=1' | sudo tee -a /boot/config.txt
        sudo sed /boot/cmdline.txt -i -e "s/console=tty1/console=tty3/"
        sudo sed /boot/cmdline.txt -i -e "s/rootwait/rootwait splash quiet plymouth.ignore-serial-consoles logo.nologo vt.global_cursor_default=0/"
    fi
fi

# install and set up camera
if [[ "$installationPackage" == "camera" ]]; then
    echo 'bcm2835-v4l2' | sudo tee -a /etc/modules

    # remove old clutter
    sudo sed /boot/config.txt -i -e "s/^startx/#startx/"
    sudo sed /boot/config.txt -i -e "s/^fixup_file/#fixup_file/"
    sudo sed /boot/config.txt -i -e "s/^\(#\|\)start_x=.*//"
    sudo sed /boot/config.txt -i -e "s/^\(#\|\)gpu_mem=.*//"

    # add new clutter :)
    echo 'start_x=1' | sudo tee -a /boot/config.txt
    echo 'gpu_mem=128' | sudo tee -a /boot/config.txt

    sudo apt install -y byacc flex
    sudo apt install -y openjdk-8-jdk
    sudo apt install -y cmake
    export JAVA_HOME=/usr/lib/jvm/java-1.8.0-openjdk-armhf/

    cd /home/pi/
    git clone --recursive https://github.com/awslabs/amazon-kinesis-video-streams-producer-sdk-cpp.git
    mkdir -p amazon-kinesis-video-streams-producer-sdk-cpp/build
    cd amazon-kinesis-video-streams-producer-sdk-cpp/build
    cmake .. -BUILD_GSTREAMER_PLUGIN=ON -DBUILD_JNI=TRUE
    sudo apt-get install libssl-dev libcurl4-openssl-dev liblog4cplus-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev gstreamer1.0-plugins-base-apps gstreamer1.0-plugins-bad gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly gstreamer1.0-tools
    make
    cd ..
    export GST_PLUGIN_PATH=`pwd`/build
    export LD_LIBRARY_PATH=`pwd`/open-source/local/lib

    cd /home/pi/amazon-kinesis-video-streams-producer-sdk-cpp
    export GST_PLUGIN_PATH=`pwd`build

    echo 'export GST_PLUGIN_PATH=$PATH:/home/pi/amazon-kinesis-video-streams-producer-sdk-cpp/build' | sudo tee -a /home/.profile

    echo 'Setting up service for cam-autostart'
    # create shell script to launch cam
    echo '#!/bin/bash' | tee /home/pi/launch-cam.sh
    echo 'export GST_PLUGIN_PATH=/home/pi/amazon-kinesis-video-streams-producer-sdk-cpp/build' | tee -a /home/pi/launch-cam.sh
    echo 'gst-launch-1.0 v4l2src do-timestamp=TRUE device=/dev/video0 ! videobalance saturation=0.0 ! clockoverlay time-format="%D %H:%M:%S" halignment=right font-desc="Sans, 16" ! videoconvert ! video/x-raw,18rmat=I420,width=532,height=400,framerate=15/1 ! omxh264enc control-rate=1 target-bitrate=512000 periodicity-idr=45 inline-header=FALSE ! h264parse ! video/x-h264,stream-format=avc,alignment=au,width=532,height=400,framerate=15/1,profile=baseline ! kvssink stream-name="'$streamname'" access-key="'$awsaccess'" secret-key="'$awssecret'" aws-region="'$awsregion'"' | tee -a /home/pi/launch-cam.sh
    chmod ugo+x /home/pi/launch-cam.sh

    # create script file
    cd /home/pi/
    sudo rm myappcafecamera.service
    echo '[Unit]' | sudo tee -a myappcafecamera.service
    echo 'Description=MyAppCafeCamera' | sudo tee -a myappcafecamera.service
    echo 'After=network.target' | sudo tee -a myappcafecamera.service
    echo '' | sudo tee -a myappcafecamera.service
    echo '[Service]' | sudo tee -a myappcafecamera.service
    echo 'ExecStart=/home/pi/launch-cam.sh' | sudo tee -a myappcafecamera.service
    echo 'WorkingDirectory=/home/pi/' | sudo tee -a myappcafecamera.service
    echo 'StandardOutput=inherit' | sudo tee -a myappcafecamera.service
    echo 'StandardError=inherit' | sudo tee -a myappcafecamera.service
    echo 'Restart=always' | sudo tee -a myappcafecamera.service
    echo 'User=pi' | sudo tee -a myappcafecamera.service
    echo 'Group=pi' | sudo tee -a myappcafecamera.service
    echo '' | sudo tee -a myappcafecamera.service
    echo '[Install]' | sudo tee -a myappcafecamera.service
    echo 'WantedBy=multi-user.target' | sudo tee -a myappcafecamera.service

    # reload services and start service
    sudo mv myappcafecamera.service /etc/systemd/system/myappcafecamera.service
    sudo systemctl daemon-reload
    sudo systemctl enable myappcafecamera.service
    sudo systemctl start myappcafecamera.service
fi


echo
echo
echo '###########################################################'
echo 'Installation completed!'
echo
echo 'Rebooting pi in 10 seconds'
echo
sleep 10
sudo reboot
echo 'Rebooting...'
