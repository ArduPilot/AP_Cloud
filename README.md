# AP_Cloud
Fleet management solution for ArduPilot Drones

Goals - a 'web gui' for:
 - a "drone management" solution
 - ability to easily get logs off the vehicle
 - ability to see drone version info in a web interface 
 - ability to update the firmware on each drone  (with appropriate hardware)
 - search through the logs and their timestamps 
 - download logs for offline review/analysis
 - and display a gui showing how recently each drone had uploaded.
 - run some sort of 'log analyser' on each log after its uploaded for stats/params/faults/etc.
 - perhaps integrate with plot.ardupilot.org , or a copy of it, for a 'plot this log' function

Technical expectations:
 - each drone needs a companion computer such as a 'raspberry pi' or similar running a ssh server
 - each drone needs the ability for AP_Cloud to ssh-into-it to run commands.
 - each drone may need a cronjob to run periodic task/checks , or this may be 'pushed' over ssh.?
 - each drone needs to be able to also ssh "into" the AP_Cloud server for log upload/s


Note: this software is intended to run "in the cloud" on VM's etc, and as such is licenced slightly differently to the normal GPL. The licnese is the "GNU Affero General Public License" which means that if you offer a commercial solution based on this software, to users who interact with it over-the-network, your server must also allow them to download the source code corresponding to the modified version running there.

https://en.wikipedia.org/wiki/GNU_Affero_General_Public_License


