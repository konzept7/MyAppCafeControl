# This script pulls the current control program for MyAppCafe
# 

# change directory to script directory
cd $(dirname $0)

# get current changes and build
git pull https://github.com/IbsKa/MyAppCafeControl.git
cp docker-compose.yml /home/pi/srv/docker-compose.yml
node index.js >> control.log

cd /home/pi/srv
docker-compose pull
docker-compose up -d