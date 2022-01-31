const express = require('express');
const config = require('config'); // see config/default.json
let path = require('path');
const fs = require('fs');

const app = express();

//const axios = require('axios');// http client to get .json from server

const wport = config.get('webserver.port');
const whost = config.get('webserver.host');

const privkeyfile = config.get('ssh_private_key');

const immutable_dronelist = config.get('dronelist'); // config is immutable by default, not what we want for this list
var dronelist = JSON.parse(JSON.stringify(immutable_dronelist)); // Low-frills deep copy


// for ssh-things
const Drone_SSH_Manager = require('./tools/ssh-manager.js')
var SSHmanager = new Drone_SSH_Manager(dronelist,privkeyfile);

// for log-handling things
const Drone_LOG_Manager = require('./tools/logfile-manager.js')
var LOGmanager = new Drone_LOG_Manager(dronelist);

// ping monitor for remote host's being up or not...
const Drone_PING_Manager = require('./tools/ping-manager.js')
var PINGManager = new Drone_PING_Manager(dronelist);

// puts it in a worker and moves on
PINGManager.start();

// setup a regular scheduled event, once every minute, using cron-like format.
// https://www.npmjs.com/package/node-schedule
const schedule = require('node-schedule');
const every_minute = schedule.scheduleJob('0,30 * * * * *', async function(){

  console.log('Scheduled SSH and log-review task/s are running...');
  
  await LOGmanager.getLogInfo();// processes existing .bin logs on startup, and on following runs, looks for new logs to process

  return;

  // put a rando test file into /tmp to prove we can..
  console.log("A running ssh file-copy...");
  await SSHmanager.putFile( '/home/buzz/GCS/AP_Cloud/ap_cloud_was_here.txt','/tmp/ap_cloud_was_here.txt');

  //get uname restults from host as an example
  var ssh_cmd='uname';
  var params_array=['-a'];
  var ssh_cwd='/tmp';
  console.log("A running ssh commands...");
  await SSHmanager.runCommand(ssh_cmd,params_array,ssh_cwd);

  // get file listing of /tmp to prove we can
  ssh_cmd='ls';
  params_array=['-aFlrt'];
  ssh_cwd='/tmp';
  console.log("B running ssh commands...");
  //await SSHmanager.runCommand(ssh_cmd,params_array,ssh_cwd)  // works, but noisy

  // multiple params, and bash completion works like this:
  ssh_cmd='ls -aFlrt /tmp/ap*';
  params_array=[];
  ssh_cwd='/tmp';
  console.log("C running ssh commands...");
  await SSHmanager.runCommand(ssh_cmd,params_array,ssh_cwd);



});

// every 5 minutes
const every_5_mins = schedule.scheduleJob('0 */5 * * * *', async function(){
  
  console.log('Scheduled SSH task/s re-enabled.');

  await SSHmanager.rsync_logs(); // probes all drone-pi's for logs and copies any new ones here.(rsync)

  await SSHmanager.re_enable_ssh_all(); // if for any reason a box wasn't ssh-able, it retrys after 5 mins becasue of this
  });


// html files/templates are in ./views/, we use the  template engine  'pug' right now
// https://pugjs.org/api/express.html
// https://www.sitepoint.com/a-beginners-guide-to-pug/
// Pug uses indentation to work out which tags are nested inside each other.  whitespace matters in .pug files
app.set('views', './views');
app.set('view engine', 'pug');

// stuff in ./public/xx is accessable as /xx
// https://www.youtube.com/watch?v=sFAT_vTxT9o&ab_channel=dcode 
app.use(express.static('public'))
app.use('/logs', express.static('logs'))  //  so /logs/drone3/123/xxx.bin is a valid url to get a log from, 
// the above line is a !!WARNING!!  it means that all logs on this box are  basically public .  todo security etc


app.get('/',  (req, res) => {
    var pinginfo = PINGManager.getPingInfo();
    //console.log("which drones are online/pingable:",pinginfo);
    for (let d of dronelist) {// 'let' allows us to edit 'd' on the fly
        if (pinginfo[d['display_name']] )
            d['lastupdate'] =  pinginfo[d['display_name']].status?'Online Now!':'';
    }
    var queuestats = LOGmanager.queue_stats();// get queue info

    res.render('index', { title: 'AP_Cloud', 
                          message: 'Welcome to AP_Cloud', 
                          dronelist:dronelist, 
                          wport:wport, whost:whost,
                          pinginfo : pinginfo,
                          queuestats : queuestats
                         })
});

// give each drone a page of its own, by-name
for (let d of dronelist) {

    //eg /drone1
    app.get('/'+d['display_name'],  (req, res) => {
        var loginfo = LOGmanager.getLogReviewInfo(d);// get up-to-date log info
        res.render('drone', { title: 'AP_Cloud', 
                            message: 'Welcome to AP_Cloud', 
                            dronelist:dronelist, 
                            wport:wport, whost:whost,
                            drone: d,
                            loginfo : loginfo
                             })
    });

}

const server = app.listen(wport, whost, (err) => {
    if (err) {
        console.log(err);
        process.exit(1);
    }
    console.log(`Server is running on ${whost}:${server.address().port}`);
});
