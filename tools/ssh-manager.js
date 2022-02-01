const {NodeSSH} = require('node-ssh'); //ssh client, but with promises
const ssh = new NodeSSH();
// if config says ssh_enable=0, never tries, otherwise it retrys once-per-minute till it fails, then it falls back to evey 5 minutes:
const ssh_retry_period_ms = 1000*60*3;
var Rsync = require('rsync');
let path = require('path');
const fs = require('fs');


class Drone_SSH_Manager {
    constructor(dronelist,privkeyfile) {
      this.dronelist = dronelist;
      this.privkeyfile = privkeyfile;
    }
    async re_enable_ssh_all () {

        // dont re-enable ones that were configured as disabled
        for (let d of this.dronelist) {
            if (  d["ZZssh_enable"] == 0) {
                if ( d["ssh_enable"] == "1" ) {
                    d["ZZssh_enable"] = 1;
                }
            }
        }

    }

    // if a drone is reporting as 'online' ( ie its pingable , etc), and its been more than 10 minuttes since we saw a log, 
    // then we'll try to rsync the entire logs folder form the drone to this server 
    //  the target folder for this 'rsync' is a "__managed" folder inside "logs_folder" : "./logs/drone1/"  so as to 
    //  discourage users from dropping logs there, but still let the log processor/s process those .
    async rsync_logs (){


        for (let d of this.dronelist) {

            //console.log(d.display_name);

                // the ping code get us 'lastupdate' indirectly. 
                // if this drone is pingable AND configured to enable it,try to ssh to it.
                //if (( d['lastupdate'] == 'Online Now!') && ( d["ssh_enable"] == "1" )) {
                if (  d["ssh_enable"] == "1" ) {

                    console.log("drone:",d['display_name'],"for RSYNC of LOGS...");

                    var remote_dir  = d['remote_logs_folder']; 
                    var target_dir  = path.resolve(d['logs_folder']+"__managed/"); // 'resolve' turns it into a absolute path
                    var ssh_user    = d['ssh_user'];
                    var ssh_host    = d['ssh_host'];

                    // make folder/s for each drone if it doesn't alreadty exist
                    fs.mkdirSync(target_dir, { recursive: true });

 
                        // https://www.npmjs.com/package/rsync
                        var rsync = new Rsync()
                        .shell('ssh')
                        .flags('raz') //'v' adds the filename list onto the 'data output1' zone...
                        //.set('progress')
                        .source(ssh_user+"@"+ssh_host+":"+remote_dir)
                        .destination(target_dir);

                        // add outback handlers
                        rsync.output(
                            function(data){
                                // do things like parse progress
                                console.log("rsync output 1",data.toString());
                            }, function(data) {
                                // do things like parse error output
                                console.log("rsync output 2",data.toString());
                            }
                        );
                        
                        // Execute the command
                        rsync.execute(function(error, code, cmd) {
                            // we're done
                            if ( code == 0) {
                                console.log(d['display_name'],"rsync done"); //ok
                            } else {
                                console.log(d['display_name'],"rsync done with error/code",cmd,error,code);
                            }
                        });



                }
                

        }

    }

    async runCommand(ssh_cmd,params_array,ssh_cwd) {

        for (let d of this.dronelist) { // iterates "modifyable"[let] values[of], not keys, this.dronelist a reference to the global 'dronelist' in index.js

            if ( d["ZZssh_enable"] == 0) { 
                console.log("not attempting to ssh to : ",d['display_name']," -- skipping");
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
                privateKey: this.privkeyfile,
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

        for (let d of this.dronelist) { // iterates "modifyable"[let] values[of], not keys, dronelist is a global

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
                privateKey: this.privkeyfile,
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

  module.exports = Drone_SSH_Manager ;