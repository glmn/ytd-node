# YouTube Doorway - Worker 
[![Build Status](https://travis-ci.org/glmn/ytd-worker.svg?branch=master)](https://travis-ci.org/glmn/ytd-worker)

### This repo is a part of `ytd` project

* [ytd-server](https://github.com/glmn/ytd-server) - Master server (`NodeJS` + `Socket.IO`) :star:
* [ytd-worker](https://github.com/glmn/ytd-worker) - Worker that render slideshow videos and upload them to youtube (`NodeJS` + `YouTube-Api`) :collision:
* [ytd-admin](https://github.com/glmn/ytd-admin) - Admin panel to monitor activities of workers (`Vue` + `Socket.IO`) :ok_hand:

### TODO:
- [x] Support multiply accounts
  - [x] Store accounts in sqlite
  - [x] Rotate accounts, when reached upload limit on each of them
  - [x] Store last uploaded video timestamp for each account
  - [x] Make delay on each account, while current time doesn't equal or bigger then last_uploaded plus limit_delay
  - [ ] Emit to server which account already using