const {NodeSSH} = require('node-ssh'); //ssh client, but with promises
const ssh = new NodeSSH();
// if config says ssh_enable=0, never tries, otherwise it retrys once-per-minute till it fails, then it falls back to evey 5 minutes:
const ssh_retry_period_ms = 1000*60*3;

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

    async runCommand(ssh_cmd,params_array,ssh_cwd) {

        for (let d of this.dronelist) { // iterates "modifyable"[let] values[of], not keys, this.dronelist a reference to the global 'dronelist' in index.js

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