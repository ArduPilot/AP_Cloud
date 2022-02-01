let path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const stat = promisify(fs.stat); 

const rra = require('recursive-readdir-async'); // recursive-readdir-async

const { spawn } = require('child_process'); // .spawn(...) doesn't block the main thread and is async

var date_format = require('date-format');

var queue = require('queue'); // a queue with timeouts
const { exit } = require('process');
var serialize = require('node-serialize');


class Drone_LOGS_Manager {
    constructor(dronelist) {
        this.dronelist = dronelist;
        this.allresults = [];
        this.isreviewed = [];// index is filename, values are timestamp of last review
        this.collectedfileinfo= []; // index is filename, values are objects {} with useful stuff
        this.in_progress = true; // bool for gui to show if we are busy or not - todo 

        this.jobtimers = []; //start time of each job saved here. idx is filename 

        this.queue = null;
        this.setup_queue();
    }
    setup_queue () {
        
        this.queue = queue({ results: [] , autostart: true, concurrency: 9}); // for managing processing jobs ... 8 is ~number of cpu cores u have 
        var self = this;
        this.queue.on('timeout', function (next, job) {
            var this_job_start = self.jobtimers[job.filename];
            var now = Date.now();
            console.log('job timed out:',job.filename,job.timeout,"job run seconds:",(now-this_job_start)/1000);
            next();
        });
        // get notified when jobs complete
        this.queue.on('success', function (result, job) {
            console.log('job result: (timeout seconds)',job.timeout/1000,result);
        });

        // begin processing, get notified on end / failure
        var self = this;
        this.queue.start(function (err) {
            if (err) throw err;
            //console.log('all done:', self.queue.results);
        });
    }

    async serialize() {

        var objS = serialize.serialize(this);

        fs.writeFile('logger_data.json', objS, function (err) {
            if (err) return console.log(err);
            console.log('serialized logger!');
          });

    }

    // reconstruct parts of the object to be iterable after deserialize
    // to prevent:  TypeError: this.dronelist is not iterable
    async deserialize (dronelist) {

        this.dronelist = dronelist;

        // now we want to forget about logs that we haven't seen 'results' for so we can re-run or compelte the processing
        for ( var fname in this.isreviewed  ){// index is filename, values are timestamp of last review
            if  ( (this.collectedfileinfo[fname] == undefined ) || (this.collectedfileinfo[fname].mtime == null  )) {
                delete(this.isreviewed[fname]);
                delete(this.allresults[fname]);
                delete(this.jobtimers[fname]);
            }
        }

        // below is basically a redo of the consturctor for the queue stuff
        this.setup_queue();

    }

    // looks on-disk 'right now' at the log folder/s for all the drones, and "collects this info" and reports it via dronelist
    async getLogInfo() {

        var newresults = []; 

        for (let d of this.dronelist) { // iterates "modifyable"[let] values[of], not keys, dronelist is a global

            //var name = d['display_name'];// drone name
            var logsfolder = d['logs_folder']; // start with '.'

            // make folder/s for each drone if it doesn't alreadty exist
            fs.mkdirSync(logsfolder, { recursive: true });

            const result = await rra.list(logsfolder);
            for (var r in result ){
                var filename = result[r].fullname;

                // ignore anying other than .bin files..
                if ( filename.endsWith('.BIN') || filename.endsWith('.bin') ) {
                    newresults.push(filename);
                    
                    // do we also "check" each of the fiels as we find them..?
                    if ( ! await this.is_file_already_reviewed(filename)) {
                        //console.log("\nreviewing file:",filename);
                        this.review_file(d,filename); // d contains drone name and other
                    } else {
                        //console.log("already reviewed:",filename);
                    }
                }
            }
            
        }
        //console.log(newresults);
        this.allresults = newresults;
        return this.allresults;
    }

    // decides to review a file if it's been on disk longer than 5 minutes . 
    async is_file_already_reviewed(filename) {

            // we wait til file is at least 5 minutes old to review, it might still be uploading
            const stats = await stat(filename); //await promise wrapper

         
            var now_ms = Date.now();
            var mtime = stats.mtime; // a Date() object
            var wait_window_ms = 1000*60; //1 minute
            //best to use .getTime() to compare dates
            var recent_ms = (now_ms - mtime.getTime());
            //console.log(filename,now_ms,mtime.getTime(),recent_ms/1000,wait_window_ms/1000)
            if(  recent_ms > wait_window_ms  ){
                // log file is at least x minutes old...

                // and we haven't got review info for this log, then revview it now
                if ( this.isreviewed[filename] == undefined ) 
                {
                    //console.log("un-reviewed log, and over a minute old",filename);
                    return false;
                }


                // old-enough, but already reviewed in this run.  
                // todo persist review date/time so we don't have to re-run old logs?

                // now we re-do the review if the file mtime is newer that the in-memory review, as its changed on-disk
                var last_review_ms = this.isreviewed[filename];
                if ( mtime > last_review_ms )  {
                    console.log("re-reviewing log, as its changed mtime on disk, and over a minute old",filename);
                    return false;
                }

                return true; // if we get here assume it doesn't need review
            }

            // not old enough yet
            return true;

    }

    queue_stats() {

        console.log("Queue info. pending:",this.queue.pending,"length:",this.queue.length);
        return { running : this.queue.pending,
                     waiting : this.queue.length};
    }

    // what this does actually is manage a bit of a Queue that limits the maimum number of 
    //  concurrent 'reviewers' to .. the numver of CPU's in the system minus 1
    async review_file(d,filename) {
 
        // this.execqueue = [];// exec queue for counting cpu-bound tasks
        // this.queueMAX = 5;  // only allow 5 simultaneous exec calls
        // this.queuecount = 0;  // holds how many execs are running

        this.isreviewed[filename] =  Date.now(); // don't re-review something that's queue'd up..

        // new queue impl...................
        const stats = await stat(filename); // await stats to continue, we need file-size-on-disk for timeout calcs
        var jobtimeout = stats.size/1000*24; // get plausible milliseconds timeout from file sie
        if (stats.size == 0 ) return false; //don't even queue empty files
        var self = this;
        function extraSlowJob (cb) {  
            self.jobtimers[filename] = Date.now();
            self.actual_review_file(d['display_name'],filename,cb);  
        }
        //cb() is to report end-of-job
        extraSlowJob.timeout = jobtimeout<5000?5000:jobtimeout; // instantiating python takes a few secs, so set a min of 3 secs
        extraSlowJob.filename = filename;
        console.log("extraSlowJob",extraSlowJob)
        this.queue.push(extraSlowJob);
        console.log(this.queue.length,this.queue.pending,this.queue.jobs.length,this.queue.results.length);

    }
      

    // the 'actual' reviewerr 
    async actual_review_file(dronename,filename, callback) {

        this.isreviewed[filename] =  Date.now(); 
        // this flags the file as reviewed immediately as soon as we 'try', but before stdout results
        //  necessarily arrive, so we don't try to review it more than once concurrently

        // where we collect info on the files etc
        if (this.collectedfileinfo[filename] == undefined ) {

            // workout a plausible url that file can be downloaded at...
            var lf = '/';
            for ( var tmp of this.dronelist ) { // lookup drone 'logs' folder from name
                if (tmp.display_name == dronename) {
                    lf = tmp.logs_folder;
                }
            }

            var idx1 = filename.indexOf(lf+1);    
            if (idx1 < 0 ) return;// string not found in output, skip it            
            var url = filename.substr(idx1);// from ibx1 to end

            this.collectedfileinfo[filename] = {
                dronename: dronename,
                mtime : null,
                size : null,
                review_stdout : null,
                bad_data : 0,
                total_time_in_air : 0,
                total_distance_travelled : 0,
                url : url
            };
        }

        // first stat() the file to get some info like last-modified and size
        const stats = await stat(filename); // await stats to continue
        
        // print file last modified date
        //console.log(`File Last-Modified: ${stats.mtime} size:  ${stats.size} bytes`);

        var formatted_date = date_format.asString('dd/MM/yyyy hh:mm:ss',stats.mtime);
        this.collectedfileinfo[filename].mtime = formatted_date; // stats.mtime is a a Date() object
        this.collectedfileinfo[filename].size = stats.size; // bytes

        // don't review empty log files
        if ( stats.size <= 0) return;

        // now run a log-alalyser of some sort...
        console.log("reviewing file:",filename);
        //var command = 'ls';
        //var args = ['-l',filename];
        var command = 'mavflighttime.py';
        var args = [filename];
        const child = spawn(command, args); //does not create a new shell , so no asterisks etc

        child.stdout.on('data', (data) => {  // data is a 'Buffer' here in node
            var datastr = data.toString();
            //console.log(`stdout:\n${datastr}`);
            this.isreviewed[filename] = Date.now();

            //Flight time : 3:59
            //Total time in air: 3:59
            //Total distance travelled: 5203.9 meters
            if ( datastr.includes('Total time in air')) {
                var idx1 = datastr.indexOf('Total time in air');    
                if (idx1 < 0 ) return;// string not found in output, skip it            
                //console.log(filename,idx1,datastr);
                var summary_data = datastr.substr(idx1);// from ibx1 to end

                var lines = summary_data.split(/\r?\n/); // split on newline/s
                var _total_time_in_air = lines[0];
                var _total_distance_travelled = lines[1];
                // minimally parse the useful bits to get: 
                this.collectedfileinfo[filename].total_time_in_air = _total_time_in_air.split(/r: /)[1];               // eg "12:24"
                this.collectedfileinfo[filename].total_distance_travelled = _total_distance_travelled.split(/d: /)[1]; // eg "8721.1 meters"

                console.log(filename,"time-in-air(h:m):",this.collectedfileinfo[filename].total_time_in_air,"distance flown:",this.collectedfileinfo[filename].total_distance_travelled );

            }

            this.collectedfileinfo[filename].review_stdout = datastr; // give it stdout as review "results"
          });
          
        child.stderr.on('data', (data) => {
            //bad header 0x4a 0xc4 at 194333
            //Skipped 213968 bad bytes in log at offset 418986, type=(163, 149, 241) (prev=None)
            //console.error(`stderr: ${data}`);
            this.collectedfileinfo[filename].bad_data += 1;
          });
          
        child.on('error', (error) => {
            console.error(`error: ${error.message}`);
            //callback();// tell whoever is waiting.. the queueing code
            //return;
          });
          
        child.on('close', (code) => {
            // if code == 0, its ok
            //console.log(`child process exited with code ${code}`);
            if ( code != 0 ) {
                console.log("review failed for log:",filename," with error code:",code);// cmd reported failure, retry?
                //this.isreviewed[filename] = undefined; // to retry over and over
            }
            var res = ""+this.collectedfileinfo[filename].review_stdout;
            callback(null,res);// tell whoever is waiting.. the queueing code
            return;
          }); 

    }

    // called from GUI , should be quick, just return cached/probed info
    // 'd' is a droneobject from dronelist, containing .display_name and .logs_folder etc
    getLogReviewInfo(d) {
        var x = this.collectedfileinfo;
        var droneinfo = [];
        for (var fname in x ) {
            //console.log(fnme,x[fname]);
            if (x[fname].dronename == d.display_name ) { 
                droneinfo.push(x[fname]);
            }
        }
        
        return droneinfo;// return everything belonging to that drone.

    }

}

module.exports = Drone_LOGS_Manager ;