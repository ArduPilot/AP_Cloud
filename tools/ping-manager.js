
const { Worker } = require('worker_threads')

class Drone_PING_Manager {
    constructor(dronelist) {
        this.dronelist = dronelist;
        this.ping_info = {};
    }
    start () {

            var workerData = this.dronelist;

            var worker = new Worker('./tools/ping-client.js', { workerData }); // workerData = dronelist

            // do it now, and setup an interval to repeat it
            worker.on('message',  (message) => {
                //console.log('received msg from ping-client', message);
                //var host= message.host;
                var dronename= message.dronename;
                //var status= message.status;
                this.ping_info[dronename] = message;
      
            });

            var self = this;
            function intervalFunc() {
                worker = new Worker('./tools/ping-client.js', { workerData }); // workerData = dronelist
            }
            setInterval(intervalFunc,3000); // 3 seconds

    }
    getPingInfo () {
        return this.ping_info;
    }
}
 
module.exports = Drone_PING_Manager;