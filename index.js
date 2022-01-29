const express = require('express');
const config = require('config'); // see config/default.json
let path = require('path');
const app = express();

const axios = require('axios');// http client to get .json from server

const wport = config.get('webserver.port');
const whost = config.get('webserver.host');

const privkeyfile = config.get('ssh_private_key');

const immutable_dronelist = config.get('dronelist'); // config is immutable by default, not what we want for this list
var dronelist = JSON.parse(JSON.stringify(immutable_dronelist)); // Low-frills deep copy


const fs = require('fs');
const {NodeSSH} = require('node-ssh'); //ssh client, but with promises
const ssh = new NodeSSH();

// if config says ssh_enable=0, never tries, otherwise it retrys once-per-minute till it fails, then it falls back to evey 5 minutes:
const ssh_retry_period_ms = 1000*60*3;


class Drone_SSH_Manager {
    constructor() {
      ///this.dronelist = dronelist;
    }
    async re_enable_ssh_all () {

        // dont re-enable ones that were configured as disabled
        for (let d of dronelist) {
            if (  d["ZZssh_enable"] == 0) {
                if ( d["ssh_enable"] == "1" ) {
                    d["ZZssh_enable"] = 1;
                }
            }
        }

    }

    async runCommand(ssh_cmd,params_array,ssh_cwd) {

        for (let d of dronelist) { // iterates "modifyable"[let] values[of], not keys, dronelist is a global

            if ( d["ZZssh_enable"] == 0) { 
                console.log("no longer attempting to ssh to : ",d['display_name']," -- skipping");
                // todo re-enable after some longer period that 1 minute?
                continue;
            }
            if ( d["ssh_enable"] == "0") { 
                console.log("config prevented ssh to : ",d['display_name']," -- skipping");
                continue;
            }
            console.log("SSH-ing to drone:",d['display_name'],"for runCommand...");
            ssh.connect({
                host:     d['ssh_host'],
                username: d['ssh_user'],
                privateKey: privkeyfile,
              }).then(function() {

                    // Command with escaped params
                    ssh.exec(ssh_cmd, params_array, { cwd: ssh_cwd, stream: 'stdout', options: { pty: true } }).then(function(result) {
                        console.log("drone:",d['display_name'],ssh_cmd, params_array,  ssh_cwd, 'STDOUT: ' + result);

                    });

                }, function(error) {
                    //d['putFile'][src] = false;
                    d["ZZssh_enable"]= 0; // don't ssh after this
                    //setTimeout(clearAttempt, ssh_retry_period_ms, d['display_name']); //5 minutes
                    console.log("failed to 'connect'ssh to:",d, "with error:",error);
                }
            
        );

        }

    }

    async putFile(src,dst) {

        for (let d of dronelist) { // iterates "modifyable"[let] values[of], not keys, dronelist is a global

            if ( d["ZZssh_enable"] == 0) { 
                console.log("no longer attempting to ssh to : ",d['display_name']," -- skipping");
                // todo re-enable after some longer period that 1 minute?
                continue;
            }
            if ( d["ssh_enable"] == "0") { 
                console.log("config prevented ssh to : ",d['display_name']," -- skipping");
                continue;
            }
            console.log("SSH-ing to drone:",d['display_name'],"for putFile...");
            ssh.connect({
                host:     d['ssh_host'],
                username: d['ssh_user'],
                privateKey: privkeyfile,
              }).then(function() {

                        //ssh.putFile('/home/steel/Lab/localPath/fileName', '/home/steel/Lab/remotePath/fileName').then(
                        ssh.putFile(src, dst).then(
                                function() {
                                d['putFile'] = [];
                                d['putFile'][src] = true;
                                console.log("drone:",d['display_name']," put file:",src," to: ",d['display_name']," at:",dst);
                            }, function(error) {
                                d['putFile'] = []; 
                                d['putFile'][src] = false;
                                d["ZZssh_enable"]= 0; // don't ssh after this
                                //setTimeout(clearAttempt, ssh_retry_period_ms, d['display_name']);
                                console.log("failed to 'putFile' ssh to:",d, "with error:",error);
                                console.log(error)
                            }
                        );

                    }, function(error) {
                        //d['putFile'][src] = false;
                        d["ZZssh_enable"]= 0; // don't ssh after this
                        //setTimeout(clearAttempt, ssh_retry_period_ms, d['display_name']); //5 minutes
                        console.log("failed to 'connect'ssh to:",d, "with error:",error);
                    }
                    
                );

        }
        return true;
    }
  }

var manager = new Drone_SSH_Manager(dronelist);


// setup a regular scheduled event, once every minute, using cron-like format.
// https://www.npmjs.com/package/node-schedule
const schedule = require('node-schedule');
const every_minute = schedule.scheduleJob('0,30 * * * * *', async function(){

  console.log('Scheduled SSH task/s are running...');

  // put a rando test file into /tmp to prove we can..
  console.log("A running ssh file-copy...");
  await manager.putFile( '/home/buzz/GCS/AP_Cloud/ap_cloud_was_here.txt','/tmp/ap_cloud_was_here.txt');

  //get uname restults from host as an example
  var ssh_cmd='uname';
  var params_array=['-a'];
  var ssh_cwd='/tmp';
  console.log("A running ssh commands...");
  await manager.runCommand(ssh_cmd,params_array,ssh_cwd);

  // get file listing of /tmp to prove we can
  ssh_cmd='ls';
  params_array=['-aFlrt'];
  ssh_cwd='/tmp';
  console.log("B running ssh commands...");
  //await manager.runCommand(ssh_cmd,params_array,ssh_cwd)  // works, but noisy

  // multiple params, and bash completion works like this:
  ssh_cmd='ls -aFlrt /tmp/ap*';
  params_array=[];
  ssh_cwd='/tmp';
  console.log("C running ssh commands...");
  await manager.runCommand(ssh_cmd,params_array,ssh_cwd);



});

// every 5 minutes
const every_5_mins = schedule.scheduleJob('0 */5 * * * *', async function(){
  
  console.log('Scheduled SSH task/s re-enabled.');

  await manager.re_enable_ssh_all();
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


app.get('/',  (req, res) => {
    res.render('index', { title: 'AP_Cloud', message: 'Welcome to AP_Cloud', dronelist:dronelist, wport:wport, whost:whost })
});

// give each drone a page of its own, by-name
for (let d of dronelist) {

    //eg /drone1
    app.get('/'+d['display_name'],  (req, res) => {
        res.render('drone', { title: 'AP_Cloud', message: 'Welcome to AP_Cloud', dronelist:dronelist, wport:wport, whost:whost, drone: d})
    });

}

const server = app.listen(wport, whost, (err) => {
    if (err) {
        console.log(err);
        process.exit(1);
    }
    console.log(`Server is running on ${whost}:${server.address().port}`);
});
