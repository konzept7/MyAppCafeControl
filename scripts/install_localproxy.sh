#!/bin/bash

echo
echo '########################'
echo '       LocalProxy'
echo '     INSTALL SCRIPT'
echo '########################'
echo

if [[ "$1" == "help" ]] || [[ "$1" == "--help" ]] || [[ "$1" == "--h" ]]; then
    echo 
    echo "HELP"
    echo "    Installs local proxy"
    echo
    echo "SYNTAX"
    echo "    install_localproxy.sh"
    echo
    echo
    echo "Example:"
    echo "  ./install_localproxy.sh"
    echo
    exit 0
fi
if [[ "$1" == "--version" ]] || [[ "$1" == "--v" ]]; then
    echo "Version 0.2"
    echo 
    exit 0
fi


echo '-----------------------------------------------------------'
echo

echo 'Installing Git and CMAKE'
sudo apt install -y git
sudo apt-get install -y cmake


cd /home/pi
mkdir dependencies
cd dependencies

echo '1. Installing ZLIB'
sudo apt install -y zlibc

echo '2. Installing Boost'
wget https://boostorg.jfrog.io/artifactory/main/release/1.69.0/source/boost_1_69_0.tar.gz -O /home/pi/dependencies/boost.tar.gz
tar xzvf /home/pi/dependencies/boost.tar.gz
cd boost_1_69_0
./bootstrap.sh
sudo ./b2 install

echo '3. Installing Protobuf'
sudo apt install -y libprotobuf-c-dev libprotobuf-c1 libprotobuf-dev libprotobuf-lite17 libprotobuf17 protobuf-c-compiler protobuf-compiler

echo '4. Installing OpenSSL DevLibs'
sudo apt install -y libssl-dev

echo '5. Installing Catch2 Test Framework'
cd /home/pi/dependencies
git clone --branch v2.13.2 https://github.com/catchorg/Catch2.git
cd Catch2
mkdir build
cd build
cmake ../
make
sudo make install
echo '-----------------------------------------------------------'
echo

cd /home/pi/
git clone https://github.com/aws-samples/aws-iot-securetunneling-localproxy
cd aws-iot-securetunneling-localproxy
git checkout a09805af404e254e5f93908db30f461b55690366
mkdir build
cd build
cmake ../
make

echo
echo
echo '###########################################################'
echo 'Installation completed!'
echo
