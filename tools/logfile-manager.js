let path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const stat = promisify(fs.stat); 

const rra = require('recursive-readdir-async'); // recursive-readdir-async

const { spawn } = require('child_process'); // .spawn(...) doesn't block the main thread and is async

var date_format = require('date-format');


class Drone_LOGS_Manager {
    constructor(dronelist) {
      this.dronelist = dronelist;
      this.allresults = [];
      this.isreviewed = [];// index is filename, values are timestamp of last review
      this.collectedfileinfo= []; // index is filename, values are objects {} with useful stuff
      this.in_progress = true; // bool for gui to show if we are busy or not - todo 
    }

    // looks on-disk 'right now' at the log folder/s for all the drones, and "collects this info" and reports it via dronelist
    async getLogInfo() {

        var newresults = []; 

        for (let d of this.dronelist) { // iterates "modifyable"[let] values[of], not keys, dronelist is a global

            var name = d['display_name'];// drone name
            var logsfolder = "."+d['logs_folder']; // start with '.'

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
                        this.review_file(name,filename);
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
                    console.log("un-reviewed log, and over a minute old",filename);
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

    async review_file(dronename,filename) {

        this.isreviewed[filename] =  Date.now(); 
        // this flags the file as reviewed immediately as soon as we 'try', but before stdout results
        //  necessarily arrive, so we don't try to review it more than once concurrently

        // where we collect info on the files etc
        if (this.collectedfileinfo[filename] == undefined ) {
            this.collectedfileinfo[filename] = {
                dronename: dronename,
                mtime : null,
                size : null,
                review_stdout : null,
                bad_data : 0,
                total_time_in_air : 0,
                total_distance_travelled : 0
            };
        }

        // first stat() the file to get some info like last-modified and size
        const stats = await stat(filename); // await stats to continue
        
        // print file last modified date
        console.log(`File Last-Modified: ${stats.mtime} size:  ${stats.size} bytes`);

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

            this.collectedfileinfo[filename].review_stdout = data; // give it stdout as review "results"
          });
          
        child.stderr.on('data', (data) => {
            //bad header 0x4a 0xc4 at 194333
            //Skipped 213968 bad bytes in log at offset 418986, type=(163, 149, 241) (prev=None)
            //console.error(`stderr: ${data}`);
            this.collectedfileinfo[filename].bad_data += 1;
          });
          
        child.on('error', (error) => {
            console.error(`error: ${error.message}`);
          });
          
        child.on('close', (code) => {
            // if code == 0, its ok
            //console.log(`child process exited with code ${code}`);
            if ( code != 0 ) {
                console.log("review failed for log:",filename," with error code:",code);// cmd reported failure, retry?
                //this.isreviewed[filename] = undefined; // to retry over and over
            }
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