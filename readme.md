# MyAppCafe Control

### Purpose

This program serves as a control program for all applications running in a MyAppCafe box. It keeps a permanent connection to a server. Commands can be sent from this server and the program will respond accordingly.

Included are also installation and registration scripts.

## Thing lifecycle

### Data preparation and software installation on Raspberry Pi

#### 1. Get data (only server)

* prepare a valid config.json and products.json for new unit

#### 2. Create box in backend (only server, all on your computer)
* *On your own computer:* Install Insomnia and import MyAppCafe Backend
* Get a new id token for myappcafe backend with your username and password `aws cognito-idp admin-initiate-auth --user-pool-id eu-central-1_7iLxD02o9 --client-id 41bsovn23a01gv0ogt1ag2ih2p --auth-flow ADMIN_NO_SRP_AUTH --auth-parameters USERNAME=<your email>,PASSWORD=<your password>`
* Copy the id token and set it in your insomnia environment
* Insomnia: Box -> Create -> body=config.json -> copy the new id
* Insomnia: Product -> Create -> set the new id in the query parameters
  
#### 3. Run install script (for all Raspberries)

* Replace &lt;password&gt; with the device password and choose depending on the device. You might have to replace 1366,768 with another display resolution, depending on the monitors.
  * **SERVER:** server server &lt;password&gt; 1366,768 192.168.155.17 5005
  * **QUEUE:** display queue &lt;password&gt; 1366,768 192.168.0.17 5007
  * **TERMINAL LEFT:** display terminalleft &lt;password&gt; 1366,768 192.168.155.17 5006
  * **TERMINAL RIGHT:** display terminalright &lt;password&gt; 1366,768 192.168.155.17 5006
* Execute the shell command with the arguments above. **Only replace &lt;arguments&gt;, the dashes are necessary!**

```shell
curl -s https://gist.githubusercontent.com/fbiel/fcbc662bb2707aeed06c4a03c4cc8579/raw/ | bash -s -- <arguments>
# example: curl -s https://gist.githubusercontent.com/fbiel/fcbc662bb2707aeed06c4a03c4cc8579/raw/ | bash -s -- server server <password> 1366,768 192.168.155.17 5005
```
#### 4. Install localproxy (only server)

``` shell
cd /home/pi/srv/MyAppCafeControl/scripts
./install_localproxy.sh
```

#### 5. Get credentials to register thing (only server)

This grants (temporary) permission to register a thing in AWS IoT. You have to repeat this step if you reboot in between.

* On your own computer **with working AWS account** and correct permissions: `aws sts get-session-token`
* You need the output from above command in the register script
* On raspberry:
``` shell
cd /home/pi/srv/MyAppCafeControl/scripts
./register.sh
```
* Restart the MyAppCafe Control service with the new credentials: `sudo systemctl restart myappcafecontrol.service`

### Run (server)

After installation and registraton, everything should run on its own. If not, you can check any error output by running MyAppCafeControl manually:
```shell
sudo systemctl stop myappcafecontrol.service
cd /home/pi/srv/MyAppCafeControl
npm i
npm run build
node dist/index.js
```

When finished, restart myappcafecontrol.service with: `sudo systemctl start myappcafecontrol.service`