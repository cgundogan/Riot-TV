/*
 * Copyright (C) 2015 Cenk Gündoğan <cnkgndgn@gmail.com>
 *
 * This file subject to the terms and conditions of the GLGPLv2 License. See the file LICENSE in the
 * top level directory for more details.
 */

/**
 * @fileoverview    The riot-tv reporter connects to an iot-lab testbed experiment in order to
 *                  collect information about the nodes and relay it to the anchor.
 *
 * @date            Aug 2015
 * @author          Cenk Gündoğan <cnkgndgn@gmail.com>
 */

/**
 * Configuration
 */
const DEFAULT_ANCHOR_HOST   = 'localhost';      /* address of the anchor */
const DEFAULT_ANCHOR_PORT   = 23511;            /* targeted port on the anchor */
const DEFAULT_SOCAT_PORT    = 20000;            /* port of the socat tcp socket to the iot-lab */
const DEFAULT_SITE          = 'grenoble';

/**
 * Library imports
 */
var net = require('net');
var JsonSocket = require('json-socket');
var sys = require('sys')
var exec = require('child_process').exec;
var proc = require('child_process');
var rl = require('readline');

/**
 * Global variables
 */
var host = DEFAULT_ANCHOR_HOST;
var port = DEFAULT_ANCHOR_PORT;
var socatPort = DEFAULT_SOCAT_PORT;
var socket = new JsonSocket(new net.Socket());  /* connection to the anchor */
var isConnected = false;                        /* flag signals if the reporter is connected to the anchor */
var comm;
var expId = 0;
var site = DEFAULT_SITE;
var nodes = {};
var nodesInfo = [];
var addrs = {}, fib = {};
var outputBuffer = {};

/**
 * Parse serial port, host and port from command line arguments
 *
 * Usage: node reporter.js [SOCAT-PORT] [ANCHOR-HOST] [ANCHOR-PORT]
 */
function parseCommandLineArgs() {
    process.argv.forEach(function(arg, index) {
        switch (index) {
            case 2:
                expId = arg;
            break;
            case 2:
                site = arg;
            break;
            case 4:
                socatPort = arg;
            break;
            case 5:
                host = arg;
            break;
            case 6:
                port = arg;
            break;
        }
    });
}

/**
 * Reporting section
 * (event handlers for the TCP connection)
 */
function connect() {
    if (isConnected) {
        return;
    }
    console.log("SOCKET: Trying to connect to " + host + ':' + port);
    socket.connect(port, host);

    socket.on('connect', function() {
        console.log('SOCKET: Reporting live from the RIOT');
        isConnected = true;
        socket.sendMessage({'type': 'nodesInfo', 'data': nodesInfo});
        console.log('Let the journalism begin, covering the RIOT - live');
    });

    socket.on('close', function(error) {
        if (!error) {
            console.log('SOCKET: Lost connection to the anchor, will try to call back');
            isConnected = false;
            connect();
        }
    });

    socket.on('error', function() {
        console.log('SOCKET: Unable to reach the anchor, will try again in 1s');
        isConnected = false;
        setTimeout(connect, 1000);
    });

    socket.on('message', function(data) {
        handleAnchorMessage(data);
    });
}

function handleAnchorMessage(data) {
    if (data.type === 'command') {
        if (data.data.nodes.length > 0) {
            var i = 0;
            data.data.nodes.forEach(function(n) {
                var cmd = n.label + ';' + data.data.cmd + "\n";
                setTimeout(function(cmd) {
                    comm.write(cmd);
                }, 150 * i++, cmd);
            });
        }
        else {
            comm.write(data.data.cmd + "\n");
        }
    }
};

function handleDeviceData(line) {
    line += '\n';
    var parts = line.split(";");
    var id = parts[1];
    var output = parts[2];

    if (!isConnected) {
        console.log("Not connected to the anchor - ignore incoming message");
        return;
    }

    bufferOutput(id, line);

    if ((output.indexOf('ifconfig\n') > -1) || ((addrs[id] !== undefined) && (addrs[id].parsing === true))) {
        parseIface(id, output);
    }
    else if ((output.indexOf('fibroute\n') > -1) || ((fib[id] !== undefined) && (fib[id].parsing === true))) {
        parseFib(id, output);
    }
    else if (output.indexOf("RTV") > -1) {
        parse_rtv_cmd(id, output);
    }
}

function bufferOutput(id, line) {
    if (line.indexOf("RTV") > -1) {
        return;
    }

    if (outputBuffer[id] === undefined) {
        outputBuffer[id] = { 'data' : line };
        setTimeout(flushBufferedCommandOutput, 200, id);
    }
    else {
        outputBuffer[id].data += line;
    }
}

function flushBufferedCommandOutput(id) {
    socket.sendMessage({ 'type': 'command_output', 'output': outputBuffer[id].data });
    delete outputBuffer[id];
    if ((addrs[id] !== undefined) && (addrs[id].parsing === true)) {
        addrs[id].parsing = false;
        socket.sendMessage({ 'type': 'ifconfig', 'node': id, 'iface': addrs[id].iface,
                             'addrs': addrs[id].addrs });
    }
    if ((fib[id] !== undefined) && (fib[id].parsing === true)) {
        fib[id].parsing = false;
        socket.sendMessage({ 'type': 'fib', 'node': id, 'entries':fib[id].entries });
    }

}

function parseIface(id, output) {
    if ((addrs[id] === undefined) || (addrs[id].parsing === false)) {
        addrs[id] = { 'parsing': true, 'iface': -1, 'addrs': [] };
        return;
    }

    var matches;

    matches = /Iface  ([^ ]+)/.exec(output);
    if (matches) {
        addrs[id].iface = matches[1];
        return;
    }

    matches = /inet6 addr: ([^ ]+)/.exec(output);
    if (matches) {
        addrs[id].addrs.push(matches[1]);
        return;
    }
}

function parseFib(id, output) {
    if ((fib[id] === undefined) || (fib[id].parsing === false)) {
        fib[id] = { 'parsing': true, 'entries': [] };
        return;
    }

    var matches;

    matches = /([^ ]+) +[^ ]+ ([^ ]+) +[^ ]+ .+? ?.+/.exec(output);
    if (matches) {
        fib[id].entries.push( { 'dst': matches[1], 'nextHop': matches[2] });
        return;
    }
}

function parse_rtv_cmd(id, output) {
    var cmd = { 'node' : id, 'type' : 'RTV' };

    /* remove line break */
    output = output.slice(0,-1);

    var rtv_cmd = output.split("|");
    cmd.subType = rtv_cmd[1];

    switch(cmd.subType) {
        case "IFCONFIG_ADDR_ADD":
            cmd.iface = rtv_cmd[2];
            cmd.ipaddr = rtv_cmd[3];
            break;
        case "IFCONFIG_ADDR_DEL":
            cmd.iface = rtv_cmd[2];
            cmd.ipaddr = rtv_cmd[3];
            break;
        case "FIB_ROUTE_ADD":
            cmd.dst = rtv_cmd[2];
            cmd.nextHop = rtv_cmd[3];
            break;
        case "FIB_ROUTE_DEL":
            cmd.dst = rtv_cmd[2];
            break;
        default:
            return;
    }

    socket.sendMessage(cmd);
}

function getNodes(error, stdout, stderr) {
    var jsonObj = JSON.parse(stdout);
    if (jsonObj.items.length === 0) {
        console.log("Experiment not running!");
        process.exit(1);
    }
    nodes = jsonObj.items[0].resources;
    var child = proc.spawnSync('experiment-cli', ['info', '-l', '--site', site]);
    var nodesInfoJSON = JSON.parse(child.stdout);
    nodes.forEach(function(n) {
        var node = nodesInfoJSON.items.filter(function(item) {
            return item.network_address == n;
        });
        if (node[0]) {
            node[0].id = node[0].network_address.split('.')[0];
            node[0].label = node[0].id;
            node[0].size = 1;
            node[0].default_size = 1;
            node[0].animate_size = 1.5;
            node[0].x = parseFloat(node[0].x) + Math.random()/3 * (Math.floor(Math.random()*2) == 1 ? 1 : -1);
            node[0].y = parseFloat(node[0].y) + Math.random()/3 * (Math.floor(Math.random()*2) == 1 ? 1 : -1);
            node[0].z = parseFloat(node[0].z) + Math.random()/3 * (Math.floor(Math.random()*2) == 1 ? 1 : -1);
            nodesInfo.push(node[0]);
        }
    });
    connect();
}

/**
 * Bootstrapping and starting the reporter
 */
console.log("RIOT-TV Reporter");
console.log("Usage: $node reporter_iotlab.js EXP_ID [SOCAT-PORT] [ANCHOR-HOST] [ANCHOR-PORT]");
parseCommandLineArgs();
if (expId === 0) {
    console.log("ERROR: Please specify an Iot-Lab Experiment ID");
    return;
}
else {
    console.log("INFO: Connecting to iot-lab experiment " + expId + " and anchor at " + host + ":" + port);
    exec("experiment-cli get -l --state Running", getNodes);
    comm = net.connect({ port: socatPort });
    comm.setNoDelay(true);
    comm.setEncoding('utf8');
    var i = rl.createInterface(comm, comm);
    i.on('line', handleDeviceData);
}
