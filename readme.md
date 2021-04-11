# MyAppCafe Control

### Purpose

This program serves as a control program for all applications running in a MyAppCafe box. It keeps a permanent connection to a server. Commands can be sent from this server and the program will respond accordingly.

### Usage

This program requires two arguments:
- BOX: The unique id of the box
- REGION: The region where the box is located

If these arguments are not passed, the program tries to read them from the environment. The preferred method is to add a .env file in the starting directory of this folder:

``` shell
nano .env
>> BOX=<id of the box>
>> REGION=<region>
Ctrl+S, Ctrl+X
```

This application also needs a **working certificate** in the root directory. If one should be missing, please 