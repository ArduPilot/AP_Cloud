const { workerData, parentPort } = require('worker_threads')

// You can do any heavy stuff here, in a synchronous way
// without blocking the "main thread"

const ping = require("ping");
var Promise = require('bluebird');// todo probably do't want bluebird, but it works like this

var dronelist = workerData;
//console.log(dronelist);
var hostlist = dronelist.map(function(d) {
    return d['ssh_host'];
});

// make a version of ping.sys.probe that returns a promise when done
ping.sys.probeAsync = function(host) {
    return new Promise(function(resolve, reject) {
        ping.sys.probe(host, function(isAlive) {
            resolve({"host": host, "status": isAlive});
        });
    });
}

function checkConnection(hosts) {
    var promises = hosts.map(function(host) {
        return ping.sys.probeAsync(host);
    });
    return Promise.all(promises).then(function(results) {
        return {results: results, timestamp: new Date().getTime()};
    });
}

checkConnection(hostlist).then(function(results) {
    // results is the {results: results, timestamp: time} object

    for ( var r of results.results) {
        //console.log(r);
        // work out the drone name from the host name/ip, assumes all drones have different ip-addresses configured
        var dronename = undefined;
        for (var x of dronelist) {
            if (x.ssh_host == r.host ) dronename = x.display_name;  
        }

        parentPort.postMessage({ host: r.host, status: r.status, dronename: dronename });
    }

});
/*
var cfg = {
    timeout: 1,
    // WARNING: -i 2 may not work in other platform like windows
    extra: ['-i', '1'],
};


    for (var x in dronelist) {
        //var d = dronelist[x];
        console.log(dronelist[x]);
        //var host = d['ssh_host'];

        ping.sys.probe(dronelist[x]['ssh_host'], function(isAlive){
            //var msg = isAlive ? 'host ' + host + ' is alive' : 'host ' + host + ' is dead';
            //console.log(msg);
            parentPort.postMessage({ host: dronelist[x]['ssh_host'], status:isAlive});
        }, cfg);

    }
*/



