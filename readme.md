
# MyAppCafeControl

This program serves as a control program for all applications running in a MyAppCafe box. It keeps a permanent connection to a server. It provides a way of controlling the MyAppCafé Server remotely.

Repo also contains installation and registration scripts.

Das Projekt befindet sich im Status: **Grundauftrag abeschlossen**

## Änderungshistorie

Diese Änderungshistorie bezieht sich ausschließlich auf die readme-Datei. Alle Details zum Changelog entnehmen Sie bitte dem Absatz 'Update- und Freigabeprozess'.


| Version | Datum | Autor | Bemerkung |
| ------- | ----- | ----- | --------- |
| 1.0.0 | 10.2.2023 | FB | Init |

Änderungen in dieser Datei sind ebenfalls der git-Historie zu entnehmen.

Es ist Aufgabe der ändernden Person, Projektbeteiligte über etwaige Änderungen zu informieren. Dies betrifft insbesondere Änderungen hinsichtlich Lasten- und Pflichtenheft.

## Risikoeinteilung TISAX

Einstufung: **Normal**

- [ ] Dieses Projekt ist ausschließlich für Mitarbeiter der IBS GnbH bestimmt
- [ ] Dieses Projekt verarbeitet *und* speichert Kundendaten
- [ ] Dieses Projekt verarbeitet *und* speichert Zahlungsdsaten
- [ ] Es gibt über das Internet erreichbare Schnittstellen

Die Einstufung wird folgendermaßen begründet:

Data is ephemeral
No data is actually stored anywhere

Secrets are only handled locally when executing installation scripts.

## Ziel und Verwendung

This program serves as a control program for all applications running in a MyAppCafe box. It keeps a permanent connection to a server. It provides a way of controlling the MyAppCafé Server remotely.

Repo also contains installation and registration scripts.

### Auftraggeber

Das Projekt wurde in Auftrag gegeben von:

**MyAppCafé**

### Beteiligte Personen

| Rolle                                   | Person                   |
| --------------------------------------- | ------------------------ |
| Projektverantwortlicher | Frank Bielecke |
| Verantwortlicher Informationssicherheit | Frank Bielecke |
| Ansprechpartner Auftraggeber | Bora Yelkenkayalar |
| Verantwortlicher Git | Frank Bielecke |


### Stundenbudget

Für den Abschluss des Projektes sind 0 Stunden veranschlagt. Dies beinhaltet:
- [x] Projektleitung und -management
- [x] Softwareentwicklung
- [x] Testing
- [x] Dokumentation
- [ ] Software-Wartung
- [ ] Support

## Voraussetzungen



### Voraussetzungen für den Betrieb

#### Betrieb der Software

- Raspberry Pi is needed for installation scripts
- Testing of registration and control program works on UNIX based machines
- Node.js runtime > 14

#### Betriebssysteme

UNIX based OS

#### Testing

You'll need a whole MyAppCafé unit with a running MyAppCaféServer to fully test the control program

## Installation und Deployment

#### Create box in backend (only server, all on your computer)

- prepare a valid config.json and products.json for new unit
- *On your own computer:* Install Insomnia and import MyAppCafe Backend
- Get a new id token for myappcafe backend with your username and password `aws cognito-idp admin-initiate-auth --user-pool-id eu-central-1_7iLxD02o9 --client-id 41bsovn23a01gv0ogt1ag2ih2p --auth-flow ADMIN_NO_SRP_AUTH --auth-parameters USERNAME=<your email>,PASSWORD=<your password>`
- Copy the id token and set it in your insomnia environment
- Insomnia: Box -> Create -> body=config.json -> copy the new id
- Insomnia: Product -> Create -> set the new id in the query parameters

#### Run install script (for all Raspberries)

- Replace &lt;password&gt; with the device password and choose depending on the device. You might have to replace 1366,768 with another display resolution, depending on the monitors.
  * **SERVER:** server server &lt;password&gt; 1366,768 192.168.155.17 5005
  * **QUEUE:** display queue &lt;password&gt; 1366,768 192.168.0.17 5007
  * **TERMINAL LEFT:** display terminalleft &lt;password&gt; 1366,768 192.168.155.17 5006
  * **TERMINAL RIGHT:** display terminalright &lt;password&gt; 1366,768 192.168.155.17 5006
* Execute the shell command with the arguments above. **Only replace &lt;arguments&gt;, the dashes are necessary!**


``` shell
# Fetch and run the install script on the raspberry

curl -s https://gist.githubusercontent.com/fbiel/fcbc662bb2707aeed06c4a03c4cc8579/raw/ | bash -s -- <arguments>
# example: curl -s https://gist.githubusercontent.com/fbiel/fcbc662bb2707aeed06c4a03c4cc8579/raw/ | bash -s -- server server <password> 1366,768 192.168.155.17 5005

# build and run

sudo systemctl stop myappcafecontrol.service
cd /home/pi/srv/MyAppCafeControl
npm i
npm run build
node dist/index.js
```

### Installation Testumgebung





### Installation Entwicklungsumgebung





### Update- und Freigabeprozess

- [x] Die hier beschriebenen Prozesse triggern einen automatisierten Release.

Since every MyAppCafe unit checks for updates regularly, any update to the master branch will cause the unit at some point to pull, build and run the code by itself.

**Thorough testing is mandatory before pushing to master**

Master branch is protected, mandatory code review by maintainers





## Checkliste

- [x] Machbarkeit geprüft
- [x] Lastenheft erstellt
- [x] Kostenplan erstellt
- [x] Kundenseitige Kosten wurden kalkuliert und weitergegeben
- [x] Verbesserungsvorschläge eingeholt
- [x] Verbesserungsvorschläge eingearbeitet
- [x] Dokumentation erstellt
- [x] Lauffähige Version erstellt, die alle gewünschten Features enthält
- [x] Auf Zielsystemen installiert
- [x] Bedienungsanleitung erstellt
- [x] Alle Secrets separiert von Projektstruktur



  