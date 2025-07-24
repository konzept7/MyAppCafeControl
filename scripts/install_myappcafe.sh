#!/bin/bash

echo '###########################################################'
echo '#                                                         #'
echo '# MyAppCafe Install script                                #'
echo '#                                                         #'
echo '###########################################################'

#!/bin/bash

home="/home/pi"

# Prompt the user to select an installation package
options=("Server" "Terminal left" "Terminal right" "Queue" "Camera" "Gate1" "Gate2" "Gate3")
echo "Please select the desired installation package:"
select package in "${options[@]}"
do
    case $package in
        "Server"|"Terminal left"|"Terminal right"|"Queue")
            # Prompt the user to select a resolution
            echo "$package is a display device. Please select the desired resolution:"
            resolutions=("1366x768" "1024x768")
            select resolution in "${resolutions[@]}"
            do
                break
            done
            break
            ;;
        *)
            break;
            break;
            ;;
    esac
done

# setting IPs
if [[ "$package" == "Server" ]]; then
    myip="192.168.155.17"
    serverip="192.168.155.17"
    hostname="SERVER"
    serverport="5005"
    installationPackage="server"
fi
if [[ "$package" == "Terminal left" ]]; then
    myip="192.168.155.36"
    serverip="192.168.155.17"
    hostname="TERMINAL-LEFT"
    serverport="5006"
    installationPackage="display"
fi
if [[ "$package" == "Terminal right" ]]; then
    myip="192.168.155.37"
    serverip="192.168.155.17"    
    hostname="TERMINAL-RIGHT"
    serverport="5006"
    installationPackage="display"
fi
if [[ "$package" == "Queue" ]]; then
    myip="192.168.155.31"
    serverip="192.168.155.17"
    hostname="QUEUE"
    serverport="5007"
    installationPackage="display"
fi
if [[ "$package" == "Camera" ]]; then

    echo "We need some more information to install the camera package"

    read -p "Enter Streamname: " streamname
    read -p "Enter AWS Access Key Id: " awsaccess
    read -p "Enter AWS Secret Access Key: " awssecret
    regions=("us-east-1" "eu-central-1" "us-west-1")
    select awsregion in "${regions[@]}"
    do
        echo "Selected region: $awsregion"
        break
    done

    myip="192.168.155.32"
    serverip="192.168.155.17"
    hostname="CAM"
    installationPackage="camera"
fi
if [[ "$package" == "Gate1" ]]; then
    myip="192.168.155.21"
    hostname="GATE1"
    installationPackage="gate"
fi
if [[ "$package" == "Gate2" ]]; then
    myip="192.168.155.22"
    hostname="GATE2"
    installationPackage="gate"
fi
if [[ "$package" == "Gate3" ]]; then
    myip="192.168.155.23"
    hostname="GATE3"
    installationPackage="gate"
fi

# Prompt the user to set a password
read -s -p "Enter password for user 'pi': " password

# Let user select the time zone
echo ""
echo "Please select your timezone:"
timezones=("Europe/Berlin" "America/New_York" "America/Los_Angeles")
select tz in "${timezones[@]}"
do
  sudo timedatectl set-timezone $tz;
  break;
done

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
    echo "  Deploy cameras with image from iot.myapp.cafe"
    exit 0

    # check if os version codename is buster 
    if [[ $(lsb_release -cs) != "buster" ]]; then
        echo "  <Camera> can only be installed on Raspberry Pi OS buster!"
        exit 0
    fi

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


echo '###########################################################'
echo '#                                                         #'
echo '# Okay, we know everything                                #'
echo '# Installation starts in 10 seconds                       #'
echo '# You can rest now                                        #'
echo '#                                                         #'
echo '###########################################################'

sleep 10

echo 'Configuring pi...'
echo "  - changing password"
sudo usermod --password $(echo $password | openssl passwd -1 -stdin) pi

echo "  - setting hostname"
sudo sed -i -E 's/127.0.1.1\t.+/127.0.1.1\t'$hostname'/' /etc/hosts
sudo rm /etc/hostname
echo "$hostname" | sudo tee -a /etc/hostname

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

echo "  - adding convenience functions"
echo 'alias la="ls -la"' >> /home/pi/.bash_aliases
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
    curl -sSL https://deb.nodesource.com/setup_20.x | sudo bash -
    sudo apt install -y nodejs

    echo "Installing zip..."
    sudo apt install -y zip unzip

    echo "Installing jq"
    sudo apt install -y jq
fi

if [[ "$installationPackage" == "server" ]] || [[ "$installationPackage" == "gate" ]]; then
    echo "Installing docker..."
    sudo apt-get install ca-certificates curl
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y
    sudo usermod -aG docker pi
    sudo systemctl start docker.service

    if [[ "$installationPackage" == "server" ]]; then
        echo "Downloading MyAppCafeControl"

        mkdir /home/pi/srv
        cd /home/pi/srv
        if [ ! -d "/home/pi/srv/MyAppCafeControl" ] ; then
            git clone https://github.com/konzept7/MyAppCafeControl
        else
            cd /home/pi/srv/MyAppCafeControl
            git pull
        fi

        if [ ! -d "/home/pi/srv/MyAppCafeControl/node_modules" ] ; then
            mkdir /home/pi/srv/MyAppCafeControl/node_modules
        fi

        echo "Downloading localproxy"
        if [ ! -d "/home/pi/aws-iot-securetunneling-localproxy/build/bin" ] ; then
            mkdir -p /home/pi/aws-iot-securetunneling-localproxy/build/bin
        fi
        cd /home/pi/aws-iot-securetunneling-localproxy/build/bin/
        wget https://s3.amazonaws.com/iot.myapp.cafe/public/localproxy_arm64
        mv localproxy_arm64 localproxy
        chmod ugo+x localproxy
        cd /home/pi/srv/MyAppCafeControl

        echo "Downloading AWS CRT"
        cd /home/pi/srv/MyAppCafeControl/node_modules/
        wget https://s3.amazonaws.com/iot.myapp.cafe/public/aws-crt.zip
        unzip aws-crt.zip
        rm aws-crt.zip

        (crontab -l ; echo "0 4 * * 0 /usr/bin/docker system prune -f")| crontab -

        echo "Installing aws cli"
        cd /home/pi
        curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
        unzip awscliv2.zip
        sudo ./aws/install

        echo "Installing nmap"
        sudo apt install nmap -y

        echo "Installing VNC"
        sudo apt install realvnc-vnc-server -y
        
        echo "Installing nginx"
        sudo apt install -y nginx
        sudo rm /etc/nginx/nginx.conf
        sudo cp /home/pi/srv/MyAppCafeControl/scripts/nginx.server.conf /etc/nginx/nginx.conf
    fi
    echo '-----------------------------------------------------------'
fi


# install and set up browser kiosk
if [[ "$installationPackage" == "server" ]] || [[ "$installationPackage" == "display" ]]; then
    echo 'Switch from wayland window manager to x11'
    # Force switch from Wayland to X11 on Raspberry Pi OS
    XSESSION=LXDE-pi-x
    XGSESSION=pi-greeter

    sudo sed -i -e "s/^#\?user-session.*/user-session=$XSESSION/" /etc/lightdm/lightdm.conf
    sudo sed -i -e "s/^#\?autologin-session.*/autologin-session=$XSESSION/" /etc/lightdm/lightdm.conf
    sudo sed -i -e "s/^#\?greeter-session.*/greeter-session=$XGSESSION/" /etc/lightdm/lightdm.conf
    sudo sed -i -e "s/^fallback-test.*/#fallback-test=/" /etc/lightdm/lightdm.conf
    sudo sed -i -e "s/^fallback-session.*/#fallback-session=/" /etc/lightdm/lightdm.conf
    sudo sed -i -e "s/^fallback-greeter.*/#fallback-greeter=/" /etc/lightdm/lightdm.conf

    if [ -e "/var/lib/AccountsService/users/$USER" ]; then
        sudo sed -i -e "s/XSession=.*/XSession=$XSESSION/" "/var/lib/AccountsService/users/$USER"
    fi



    echo 'Installing required software for browser-kiosk...'
    sudo apt-get install -y chromium lxde lightdm xserver-xorg unclutter-xfixes realvnc-vnc-server
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


    echo 'Setting up window-session...'
    sudo systemctl disable lightdm
    cat > ~/.xinitrc <<EOF
    xset s off
    xset -dpms
    xset s noblank
    unclutter-xfixes &
    sed -i 's/"exited_cleanly": false/"exited_cleanly": true/' ~/.config/chromium/Default/Preferences
    chromium-browser --noerrdialogs http://192.168.155.17:5005/ --incognito --kiosk --start-fullscreen --disable-translate --disable-features=Translate --window-size=1024x768 --window-position=0,0 --check-for-update-interval=604800 --disable-pinch --overscroll-history-navigation=0
EOF
    echo '[[ -z $DISPLAY && $(tty) = /dev/tty1 ]] && startx' >> ~/.bashrc


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
    if [[ "$installationPackage" == "server" ]]; then
      sudo chmod ugo+x /home/pi/srv/MyAppCafeControl/scripts/update_myappcafecontrol.sh
      (crontab -l ; echo "@reboot /home/pi/srv/MyAppCafeControl/scripts/update_myappcafecontrol.sh") | crontab -
      (crontab -l ; echo "0 2 15 * * /home/pi/srv/MyAppCafeControl/scripts/update_myappcafecontrol.sh") | crontab -
      # fallback solution for script-hang (nightly restart)
      (crontab -l ; echo "30 2 * * * sudo systemctl restart myappcafecontrol.service") | crontab -
    fi

    # for display-only devices set up quiet/invisible boot
    if [[ "$installationPackage" == "display" ]]; then
        echo 'disable_splash=1' | sudo tee -a /boot/config.txt
        sudo sed /boot/cmdline.txt -i -e "s/console=tty1/console=tty3/"
        sudo sed /boot/cmdline.txt -i -e "s/rootwait/rootwait splash quiet plymouth.ignore-serial-consoles logo.nologo vt.global_cursor_default=0/"
    fi
fi


routerip="192.168.155.1"
touch /home/pi/set-ip.sh
cat > /home/pi/set-ip.sh << EOF
    sudo nmcli con mod "Wired connection 1" ipv4.addresses $myip/24
    sudo nmcli con mod "Wired connection 1" ipv4.gateway $routerip
    sudo nmcli con mod "Wired connection 1" ipv4.dns "9.9.9.9"
    sudo nmcli con mod "Wired connection 1" ipv4.method manual
    sudo nmcli con down "Wired connection 1" && sudo nmcli con up "Wired connection 1" && sudo reboot
EOF
cd /home/pi/
sudo chmod +x set-ip.sh

echo
echo
echo '###########################################################'
echo '#                                                         #'
echo '# Installation complete!                                  #'
echo '#                                                         #'
echo '# Execute ./set-ip.sh to set a static IP                  #'
echo '#                                                         #'
echo '# Rebooting Pi in 1 minute, interrupt with CTRL+C         #'
echo '#                                                         #'
echo '###########################################################'
echo ''
echo ''
sleep 50
echo 'Rebooting in 10 seconds...'
sleep 10
sudo reboot